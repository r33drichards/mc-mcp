import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import mineflayer, { Bot } from "mineflayer";
import mineflayerPathfinder from "mineflayer-pathfinder";
import { readFile } from "fs/promises";
import minecraftData from "minecraft-data";
import { Vec3 } from "vec3";
const { pathfinder, Movements, goals } = mineflayerPathfinder;

// Configuration from environment
const MC_HOST = process.env.MC_HOST || "localhost";
const MC_PORT = parseInt(process.env.MC_PORT || "25565");
const MC_USERNAME = process.env.MC_USERNAME || "mcp-bot";
const MC_PASSWORD = process.env.MC_PASSWORD;
const MC_AUTH = process.env.MC_AUTH || "microsoft"; // "offline" for cracked servers

// Bot state
let bot: Bot | null = null;
let botReady = false;
let mcData: ReturnType<typeof minecraftData> | null = null;

// Task tracking for background eval
interface Task {
  id: string;
  code: string;
  status: "running" | "completed" | "error" | "cancelled";
  result?: string;
  error?: string;
  startedAt: Date;
  completedAt?: Date;
  abortController?: AbortController;
}

const tasks = new Map<string, Task>();
let taskIdCounter = 0;

function generateTaskId(): string {
  return `task_${++taskIdCounter}_${Date.now()}`;
}

// Create the MCP server
const server = new McpServer({
  name: "mineflayer-mcp",
  version: "1.0.0",
});

// Tool: Connect to Minecraft server
server.tool(
  "connect",
  "Connect the bot to a Minecraft server",
  {
    host: z.string().optional().describe("Minecraft server host (default: localhost)"),
    port: z.number().optional().describe("Minecraft server port (default: 25565)"),
    username: z.string().optional().describe("Bot username (default: mcp-bot)"),
    auth: z.enum(["offline", "microsoft"]).optional().describe("Auth mode: 'offline' for cracked servers, 'microsoft' for premium (default: microsoft)"),
  },
  async ({ host, port, username, auth }) => {
    if (bot && botReady) {
      return {
        content: [{ type: "text", text: "Bot is already connected. Use disconnect first." }],
      };
    }

    const connectHost = host || MC_HOST;
    const connectPort = port || MC_PORT;
    const connectUsername = username || MC_USERNAME;
    const connectAuth = auth || MC_AUTH;

    return new Promise((resolve) => {
      bot = mineflayer.createBot({
        host: connectHost,
        port: connectPort,
        username: connectUsername,
        password: MC_PASSWORD,
        auth: connectAuth as "offline" | "microsoft",
      });

      bot.on("spawn", async () => {
        try {
          console.error("[mineflayer-mcp] Bot spawned, loading pathfinder...");
          bot!.loadPlugin(pathfinder);
          const defaultMovements = new Movements(bot!);
          bot!.pathfinder.setMovements(defaultMovements);
          console.error("[mineflayer-mcp] Pathfinder loaded, loading minecraft-data...");
          mcData = minecraftData(bot!.version);
          console.error(`[mineflayer-mcp] Loaded minecraft-data for version ${bot!.version}`);
          console.error("[mineflayer-mcp] Waiting for chunks...");
          await bot!.waitForChunksToLoad();
          console.error("[mineflayer-mcp] Chunks loaded, bot ready");

          botReady = true;
          resolve({
            content: [
              {
                type: "text",
                text: `Connected to ${connectHost}:${connectPort} as ${connectUsername}. Bot is ready.`,
              },
            ],
          });
        } catch (err: any) {
          console.error("[mineflayer-mcp] Spawn error:", err);
          resolve({
            content: [{ type: "text", text: `Spawn/initialization error: ${err.message}\n${err.stack}` }],
            isError: true,
          });
        }
      });

      bot.on("error", (err) => {
        botReady = false;
        resolve({
          content: [{ type: "text", text: `Connection error: ${err.message}` }],
          isError: true,
        });
      });

      bot.on("kicked", (reason) => {
        botReady = false;
        resolve({
          content: [{ type: "text", text: `Kicked from server: ${reason}` }],
          isError: true,
        });
      });

      // Timeout after 30 seconds
      setTimeout(() => {
        if (!botReady) {
          resolve({
            content: [{ type: "text", text: "Connection timeout after 30 seconds" }],
            isError: true,
          });
        }
      }, 30000);
    });
  }
);

// Tool: Disconnect from server
server.tool(
  "disconnect",
  "Disconnect the bot from the Minecraft server",
  {},
  async () => {
    if (!bot) {
      return {
        content: [{ type: "text", text: "Bot is not connected." }],
      };
    }

    bot.end();
    bot = null;
    botReady = false;

    return {
      content: [{ type: "text", text: "Disconnected from server." }],
    };
  }
);

// Helper to stringify results
function stringifyResult(result: unknown): string {
  if (result === undefined) {
    return "undefined";
  } else if (result === null) {
    return "null";
  } else if (typeof result === "object") {
    try {
      return JSON.stringify(result, null, 2);
    } catch {
      return String(result);
    }
  } else {
    return String(result);
  }
}

// Helper to execute code with bot context
async function executeCode(code: string, currentBot: Bot, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) {
    throw new Error("Task was cancelled before execution");
  }
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const fn = new AsyncFunction(
    "bot", "goals", "Movements", "signal", "mcData", "Vec3",
    `return (async () => { ${code} })()`
  );
  const result = await fn(currentBot, goals, Movements, signal, mcData, Vec3);
  return stringifyResult(result);
}

// Tool: Eval - execute JavaScript code with bot context
server.tool(
  "eval",
  "Execute JavaScript code with access to the bot object (like a REPL). Use background=true for long-running tasks. Available: bot, goals (GoalFollow, GoalNear, GoalBlock, GoalXZ, GoalY, GoalGetToBlock), Movements, mcData (minecraft-data), Vec3.",
  {
    code: z.string().describe("JavaScript code to execute. Available: bot, goals, Movements, mcData (for items/blocks/recipes), Vec3."),
    background: z.boolean().optional().describe("Run in background and return task ID (default: false)"),
  },
  async ({ code, background }) => {
    if (!bot || !botReady) {
      return {
        content: [{ type: "text", text: "Bot is not connected. Use connect tool first." }],
        isError: true,
      };
    }

    // Background execution
    if (background) {
      const taskId = generateTaskId();
      const abortController = new AbortController();
      const task: Task = {
        id: taskId,
        code,
        status: "running",
        startedAt: new Date(),
        abortController,
      };
      tasks.set(taskId, task);

      // Run in background (don't await)
      const currentBot = bot; // Capture reference
      executeCode(code, currentBot, abortController.signal)
        .then((result) => {
          if (task.status === "running") {
            task.status = "completed";
            task.result = result;
            task.completedAt = new Date();
          }
        })
        .catch((err: Error) => {
          if (task.status === "running") {
            task.status = "error";
            task.error = `${err.message}\n${err.stack}`;
            task.completedAt = new Date();
          }
        });

      return {
        content: [{ type: "text", text: `Task started in background.\nTask ID: ${taskId}\nUse get_task to check status.` }],
      };
    }

    // Synchronous execution with 30s timeout
    const EVAL_TIMEOUT_MS = 30000;
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Eval timed out after ${EVAL_TIMEOUT_MS / 1000}s. Use background=true for long-running tasks.`)), EVAL_TIMEOUT_MS);
      });
      const result = await Promise.race([executeCode(code, bot), timeoutPromise]);
      return {
        content: [{ type: "text", text: `Result:\n${result}` }],
      };
    } catch (err: unknown) {
      const error = err as Error;
      return {
        content: [{ type: "text", text: `Eval error: ${error.message}\n${error.stack}` }],
        isError: true,
      };
    }
  }
);

// Tool: Get task status and output
server.tool(
  "get_task",
  "Get the status and output of a background task",
  {
    task_id: z.string().describe("The task ID returned from eval with background=true"),
  },
  async ({ task_id }) => {
    const task = tasks.get(task_id);
    if (!task) {
      return {
        content: [{ type: "text", text: `Task not found: ${task_id}` }],
        isError: true,
      };
    }

    const duration = task.completedAt
      ? `${(task.completedAt.getTime() - task.startedAt.getTime()) / 1000}s`
      : `${(Date.now() - task.startedAt.getTime()) / 1000}s (running)`;

    let output = `Task ID: ${task.id}\nStatus: ${task.status}\nDuration: ${duration}\nCode: ${task.code.slice(0, 100)}${task.code.length > 100 ? "..." : ""}\n`;

    if (task.status === "completed") {
      output += `\nResult:\n${task.result}`;
    } else if (task.status === "error") {
      output += `\nError:\n${task.error}`;
    }

    return {
      content: [{ type: "text", text: output }],
    };
  }
);

// Tool: List all tasks
server.tool(
  "list_tasks",
  "List all background tasks and their status",
  {
    status: z.enum(["all", "running", "completed", "error", "cancelled"]).optional().describe("Filter by status (default: all)"),
  },
  async ({ status }) => {
    const filterStatus = status || "all";
    const filteredTasks = Array.from(tasks.values()).filter(
      (task) => filterStatus === "all" || task.status === filterStatus
    );

    if (filteredTasks.length === 0) {
      return {
        content: [{ type: "text", text: `No tasks found${filterStatus !== "all" ? ` with status: ${filterStatus}` : ""}.` }],
      };
    }

    const taskList = filteredTasks
      .map((task) => {
        const duration = task.completedAt
          ? `${(task.completedAt.getTime() - task.startedAt.getTime()) / 1000}s`
          : `${(Date.now() - task.startedAt.getTime()) / 1000}s`;
        return `- ${task.id}: ${task.status} (${duration}) - ${task.code.slice(0, 50)}${task.code.length > 50 ? "..." : ""}`;
      })
      .join("\n");

    return {
      content: [{ type: "text", text: `Tasks (${filteredTasks.length}):\n${taskList}` }],
    };
  }
);

// Tool: Cancel a running task
server.tool(
  "cancel_task",
  "Cancel a running background task. Aborts execution and stops any active pathfinder goals.",
  {
    task_id: z.string().describe("The task ID to cancel"),
  },
  async ({ task_id }) => {
    const task = tasks.get(task_id);
    if (!task) {
      return {
        content: [{ type: "text", text: `Task not found: ${task_id}` }],
        isError: true,
      };
    }

    if (task.status !== "running") {
      return {
        content: [{ type: "text", text: `Task ${task_id} is not running (status: ${task.status})` }],
        isError: true,
      };
    }

    // Abort the task
    task.abortController?.abort();
    task.status = "cancelled";
    task.completedAt = new Date();

    // Stop any active pathfinder goals
    if (bot && botReady) {
      try {
        bot.pathfinder.stop();
      } catch {
        // Ignore if pathfinder not active
      }
    }

    const duration = `${(task.completedAt.getTime() - task.startedAt.getTime()) / 1000}s`;
    return {
      content: [{ type: "text", text: `Task ${task_id} cancelled after ${duration}.\nPathfinder goals stopped.` }],
    };
  }
);

// Tool: Load and execute a script from a file
server.tool(
  "eval_file",
  "Load and execute a JavaScript file with access to the bot object. Same as eval but loads code from a file.",
  {
    file_path: z.string().describe("Absolute path to the JavaScript file to execute"),
    background: z.boolean().optional().describe("Run in background and return task ID (default: false)"),
  },
  async ({ file_path, background }) => {
    if (!bot || !botReady) {
      return {
        content: [{ type: "text", text: "Bot is not connected. Use connect tool first." }],
        isError: true,
      };
    }

    // Read the file
    let code: string;
    try {
      code = await readFile(file_path, "utf-8");
    } catch (err: unknown) {
      const error = err as Error;
      return {
        content: [{ type: "text", text: `Failed to read file: ${error.message}` }],
        isError: true,
      };
    }

    // Background execution
    if (background) {
      const taskId = generateTaskId();
      const abortController = new AbortController();
      const task: Task = {
        id: taskId,
        code: `[file: ${file_path}]\n${code.slice(0, 200)}${code.length > 200 ? "..." : ""}`,
        status: "running",
        startedAt: new Date(),
        abortController,
      };
      tasks.set(taskId, task);

      const currentBot = bot;
      executeCode(code, currentBot, abortController.signal)
        .then((result) => {
          if (task.status === "running") {
            task.status = "completed";
            task.result = result;
            task.completedAt = new Date();
          }
        })
        .catch((err: Error) => {
          if (task.status === "running") {
            task.status = "error";
            task.error = `${err.message}\n${err.stack}`;
            task.completedAt = new Date();
          }
        });

      return {
        content: [{ type: "text", text: `Task started from file: ${file_path}\nTask ID: ${taskId}\nUse get_task to check status.` }],
      };
    }

    // Synchronous execution with 30s timeout
    const EVAL_TIMEOUT_MS = 30000;
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Eval timed out after ${EVAL_TIMEOUT_MS / 1000}s. Use background=true for long-running tasks.`)), EVAL_TIMEOUT_MS);
      });
      const result = await Promise.race([executeCode(code, bot), timeoutPromise]);
      return {
        content: [{ type: "text", text: `File: ${file_path}\nResult:\n${result}` }],
      };
    } catch (err: unknown) {
      const error = err as Error;
      return {
        content: [{ type: "text", text: `Eval error in ${file_path}: ${error.message}\n${error.stack}` }],
        isError: true,
      };
    }
  }
);

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
