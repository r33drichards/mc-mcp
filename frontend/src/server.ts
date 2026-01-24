import express from 'express'
import cors from 'cors'
import { minecraftAgent } from './agent'
import { HumanMessage, AIMessage } from '@langchain/core/messages'

const app = express()
const port = process.env.AGENT_PORT || 3007

// Enable CORS
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['*'],
}))

app.use(express.json())

// Custom agent endpoint that runs the LangGraph agent
app.post('/api/agent', async (req, res) => {
  try {
    const { messages } = req.body
    console.log('Received messages:', JSON.stringify(messages, null, 2))

    // Convert incoming messages to LangChain format
    const langchainMessages = (messages || []).map((msg: { role: string; content: string }) => {
      if (msg.role === 'user') {
        return new HumanMessage(msg.content)
      } else if (msg.role === 'assistant') {
        return new AIMessage(msg.content || '')
      }
      return new HumanMessage(msg.content)
    })

    console.log('Invoking agent with', langchainMessages.length, 'messages')

    // Run the agent
    const result = await minecraftAgent.invoke({
      messages: langchainMessages,
    })

    console.log('Agent returned', result.messages.length, 'messages')

    // Get the final assistant message
    const finalMessages = result.messages
    const lastMessage = finalMessages[finalMessages.length - 1]

    let responseContent = ''
    if (lastMessage && typeof lastMessage.content === 'string') {
      responseContent = lastMessage.content
    } else if (lastMessage && Array.isArray(lastMessage.content)) {
      responseContent = lastMessage.content
        .filter((c: { type: string }) => c.type === 'text')
        .map((c: { text: string }) => c.text)
        .join('\n')
    }

    console.log('Sending response:', responseContent.substring(0, 100) + '...')

    // Send simple JSON response
    res.json({ response: responseContent })
  } catch (error) {
    console.error('Agent error:', error)
    res.status(500).json({
      error: 'Agent execution failed',
      response: `Error: ${error instanceof Error ? error.message : String(error)}`,
    })
  }
})

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' })
})

app.listen(port, () => {
  console.log(`Agent server listening at http://localhost:${port}`)
})
