import { ChatOpenAI } from '@langchain/openai'
import { tool } from '@langchain/core/tools'
import { StateGraph, Annotation, START, END } from '@langchain/langgraph'
import { BaseMessage, HumanMessage, AIMessage, ToolMessage } from '@langchain/core/messages'
import { z } from 'zod'

const MCP_SERVER_URL = process.env.MCP_SERVER_URL || 'http://localhost:3001/mcp'

// Helper to call MCP tools
async function callMcpTool(name: string, args: Record<string, unknown> = {}) {
  const response = await fetch(MCP_SERVER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name, arguments: args },
      id: Date.now(),
    }),
  })

  // MCP server returns SSE format - parse it
  const text = await response.text()
  let result
  try {
    // Handle SSE format: "event: message\ndata: {...}"
    const dataLine = text.split('\n').find((line) => line.startsWith('data: '))
    if (dataLine) {
      result = JSON.parse(dataLine.substring(6))
    } else {
      // Try parsing as plain JSON
      result = JSON.parse(text)
    }
  } catch {
    return `Error parsing MCP response: ${text.substring(0, 200)}`
  }

  if (result.error) {
    return `Error: ${result.error.message || JSON.stringify(result.error)}`
  }
  // Extract text content from MCP response
  if (result.result?.content) {
    return result.result.content
      .filter((c: { type: string }) => c.type === 'text')
      .map((c: { text: string }) => c.text)
      .join('\n')
  }
  return JSON.stringify(result.result || result)
}

// Define tools that wrap MCP calls
const connectTool = tool(
  async () => {
    return await callMcpTool('connect', {})
  },
  {
    name: 'connect_to_minecraft',
    description: 'Connect the bot to the Minecraft server. Call this first before any other bot operations.',
    schema: z.object({}),
  }
)

const disconnectTool = tool(
  async () => {
    return await callMcpTool('disconnect', {})
  },
  {
    name: 'disconnect_from_minecraft',
    description: 'Disconnect the bot from the Minecraft server.',
    schema: z.object({}),
  }
)

const screenshotTool = tool(
  async () => {
    return await callMcpTool('screenshot', {})
  },
  {
    name: 'take_screenshot',
    description: 'Take a screenshot of what the Minecraft bot currently sees.',
    schema: z.object({}),
  }
)

const evalTool = tool(
  async ({ code, background }: { code: string; background?: boolean }) => {
    return await callMcpTool('eval', { code, background: background || false })
  },
  {
    name: 'execute_bot_code',
    description: `Execute JavaScript code on the Minecraft bot. Use 'return' to get results.
Available objects: bot (mineflayer), goals (pathfinder GoalFollow/GoalNear/GoalBlock/GoalXZ/GoalY/GoalGetToBlock), Movements, mcData, Vec3.
Examples:
- Get health: return bot.health
- Get position: return bot.entity.position
- Find blocks: return bot.findBlocks({ matching: mcData.blocksByName.oak_log.id, maxDistance: 32, count: 10 })
- Move to position: bot.pathfinder.setGoal(new goals.GoalBlock(x, y, z))`,
    schema: z.object({
      code: z.string().describe('JavaScript code to execute. Use return to get results.'),
      background: z.boolean().optional().describe('Run in background for long tasks'),
    }),
  }
)

const wikiSearchTool = tool(
  async ({ query, limit }: { query: string; limit?: number }) => {
    return await callMcpTool('wiki_search', { query, limit: limit || 5 })
  },
  {
    name: 'wiki_search',
    description: 'Search the Minecraft wiki for information. Good for finding specific terms, item names, mob names, etc.',
    schema: z.object({
      query: z.string().describe('Search query (e.g., "zombie spawn conditions", "diamond sword damage")'),
      limit: z.number().optional().describe('Maximum number of results (default: 5)'),
    }),
  }
)

const wikiGetTool = tool(
  async ({ title }: { title: string }) => {
    return await callMcpTool('wiki_get', { title })
  },
  {
    name: 'wiki_get',
    description: 'Get the full content of a specific Minecraft wiki article by title.',
    schema: z.object({
      title: z.string().describe('Article title (e.g., "Zombie", "Diamond Sword", "Crafting")'),
    }),
  }
)

// All available tools
const tools = [connectTool, disconnectTool, screenshotTool, evalTool, wikiSearchTool, wikiGetTool]

// Define state
const AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),
})

// Create the model with tools bound
const model = new ChatOpenAI({
  model: 'gpt-4o',
  temperature: 0,
}).bindTools(tools)

// Agent node - decides what to do
async function agentNode(state: typeof AgentState.State) {
  const systemMessage = {
    role: 'system',
    content: `You are an AI assistant controlling a Minecraft bot. You have access to tools to:
- Connect/disconnect the bot to the Minecraft server
- Take screenshots of what the bot sees
- Execute JavaScript code on the bot (using mineflayer)
- Search the Minecraft wiki for information

Always connect to the server first before trying to control the bot.
When executing code, use 'return' to get results back.
Be helpful and explain what you're doing.`,
  }

  const response = await model.invoke([systemMessage, ...state.messages])
  return { messages: [response] }
}

// Tool execution node
async function toolNode(state: typeof AgentState.State) {
  const lastMessage = state.messages[state.messages.length - 1] as AIMessage
  const toolCalls = lastMessage.tool_calls || []

  const toolResults: ToolMessage[] = []

  for (const toolCall of toolCalls) {
    const selectedTool = tools.find((t) => t.name === toolCall.name)
    if (selectedTool) {
      try {
        const result = await selectedTool.invoke(toolCall.args)
        toolResults.push(
          new ToolMessage({
            tool_call_id: toolCall.id!,
            content: typeof result === 'string' ? result : JSON.stringify(result),
          })
        )
      } catch (error) {
        toolResults.push(
          new ToolMessage({
            tool_call_id: toolCall.id!,
            content: `Error: ${error instanceof Error ? error.message : String(error)}`,
          })
        )
      }
    }
  }

  return { messages: toolResults }
}

// Router - decides if we should continue to tools or end
function shouldContinue(state: typeof AgentState.State): 'tools' | typeof END {
  const lastMessage = state.messages[state.messages.length - 1] as AIMessage
  if (lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
    return 'tools'
  }
  return END
}

// Build the graph
const workflow = new StateGraph(AgentState)
  .addNode('agent', agentNode)
  .addNode('tools', toolNode)
  .addEdge(START, 'agent')
  .addConditionalEdges('agent', shouldContinue)
  .addEdge('tools', 'agent')

export const minecraftAgent = workflow.compile()

export type MinecraftAgentState = typeof AgentState.State
