// Browser API polyfills for Three.js in Node.js environment
// Must be set before importing Three.js
(global as any).requestAnimationFrame = (callback: FrameRequestCallback): number => {
  return setTimeout(callback, 16) as unknown as number;
};
(global as any).cancelAnimationFrame = (id: number): void => {
  clearTimeout(id);
};

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { z } from "zod";
import mineflayer, { Bot } from "mineflayer";
import mineflayerPathfinder from "mineflayer-pathfinder";
import { readFile, writeFile, mkdir, stat } from "fs/promises";
import {
  initKnowledge,
  searchFullText,
  searchSemantic,
  searchHybrid,
  getDocument,
  getStats,
  listByCategory,
  indexSkills,
  type SearchResult,
} from "./knowledge.js";
import minecraftData from "minecraft-data";
import { Vec3 } from "vec3";
const { pathfinder, Movements, goals } = mineflayerPathfinder;

// Screenshot dependencies
// @ts-ignore - no types available
import prismarineViewer from "prismarine-viewer/viewer/index.js";
const { Viewer, WorldView, getBufferFromStream } = prismarineViewer;
// @ts-ignore - no types available
import { createCanvas } from "node-canvas-webgl/lib/index.js";
import * as THREE from "three";
import { Worker } from "worker_threads";
// Set global Worker for prismarine-viewer
(global as any).Worker = Worker;

// Web viewer for live view
// @ts-ignore - no types available
import { mineflayer as mineflayerViewer } from "prismarine-viewer";

// Configuration from environment
const MC_HOST = process.env.MC_HOST || "localhost";
const MC_PORT = parseInt(process.env.MC_PORT || "25565");
const MC_USERNAME = process.env.MC_USERNAME || "mcp-bot";
const MC_PASSWORD = process.env.MC_PASSWORD;
const MC_AUTH = process.env.MC_AUTH || "microsoft"; // "offline" for cracked servers
const VIEWER_PORT = parseInt(process.env.VIEWER_PORT || "3000");

// Bot state
let bot: Bot | null = null;
let botReady = false;
let mcData: ReturnType<typeof minecraftData> | null = null;

// Prevent crashes from unhandled errors (e.g., prismarine-chat 1.21.4 issues)
process.on("uncaughtException", (err) => {
  console.error("[mineflayer-mcp] Uncaught exception (recovered):", err.message);
  // Don't exit - try to keep running
});
process.on("unhandledRejection", (reason) => {
  console.error("[mineflayer-mcp] Unhandled rejection (recovered):", reason);
});

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
          console.error("[mineflayer-mcp] Waiting for chunks (max 10s)...");
          // Wait for chunks with timeout - don't block forever
          await Promise.race([
            bot!.waitForChunksToLoad(),
            new Promise(resolve => setTimeout(resolve, 10000))
          ]);
          console.error("[mineflayer-mcp] Proceeding (chunks may still be loading)");

          // Start web viewer (firstPerson: false for third-party view with freelook)
          try {
            mineflayerViewer(bot! as any, { port: VIEWER_PORT, firstPerson: true });
            console.error(`[mineflayer-mcp] Web viewer started on port ${VIEWER_PORT} (third-party view)`);
          } catch (viewerErr: any) {
            console.error("[mineflayer-mcp] Web viewer failed to start:", viewerErr.message);
          }

          botReady = true;
          resolve({
            content: [
              {
                type: "text",
                text: `Connected to ${connectHost}:${connectPort} as ${connectUsername}. Bot is ready. Viewer on port ${VIEWER_PORT}.`,
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
        console.error("[mineflayer-mcp] Bot kicked:", reason);
        botReady = false;
        bot = null;
        resolve({
          content: [{ type: "text", text: `Kicked from server: ${reason}` }],
          isError: true,
        });
      });

      bot.on("end", (reason) => {
        console.error("[mineflayer-mcp] Bot disconnected:", reason);
        botReady = false;
        bot = null;
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

// Screenshot tool - takes a screenshot of the bot's view
server.tool(
  "screenshot",
  "Take a screenshot of the bot's view in Minecraft. Returns the image as base64 JPEG or saves to a file.",
  {
    output_path: z.string().optional().describe("Optional file path to save the screenshot (e.g., '/tmp/screenshot.jpg'). If not provided, returns base64 image data."),
    width: z.number().optional().describe("Image width in pixels (default: 512)"),
    height: z.number().optional().describe("Image height in pixels (default: 512)"),
    direction: z.object({
      x: z.number(),
      y: z.number(),
      z: z.number(),
    }).optional().describe("Direction to look (relative to bot position). Default: { x: 1, y: -0.2, z: 0 }"),
    view_distance: z.number().optional().describe("View distance in chunks (default: 4)"),
  },
  async ({ output_path, width, height, direction, view_distance }) => {
    if (!bot || !botReady) {
      return {
        content: [{ type: "text", text: "Bot is not connected. Use connect tool first." }],
        isError: true,
      };
    }

    const imgWidth = width || 512;
    const imgHeight = height || 512;
    const viewDist = view_distance || 4;
    const dir = direction || { x: 1, y: -0.2, z: 0 };

    try {
      console.error("[mineflayer-mcp] Taking screenshot...");

      // Create canvas and renderer
      const canvas = createCanvas(imgWidth, imgHeight);
      const renderer = new THREE.WebGLRenderer({ canvas });
      const viewer = new Viewer(renderer);

      // Get bot position
      const botPos = bot.entity.position;
      const center = new Vec3(botPos.x, botPos.y + 1.6, botPos.z); // Eye height

      // Set version and create world view
      viewer.setVersion(bot.version);
      const worldView = new WorldView(bot.world, viewDist, center);
      viewer.listen(worldView);

      // Listen to bot events to sync world data
      worldView.listenToBot(bot);

      // Position camera at bot's eye position
      viewer.camera.position.set(center.x, center.y, center.z);

      // Initialize world view
      await worldView.init(center);

      // Set camera direction
      const cameraPos = new Vec3(viewer.camera.position.x, viewer.camera.position.y, viewer.camera.position.z);
      const lookDir = new Vec3(dir.x, dir.y, dir.z);
      const point = cameraPos.add(lookDir);
      viewer.camera.lookAt(point.x, point.y, point.z);

      // Wait for chunks to actually render (not just a timeout)
      console.error("[mineflayer-mcp] Waiting for world chunks to render...");
      await viewer.world.waitForChunksToRender();

      // Render the scene
      renderer.render(viewer.scene, viewer.camera);

      // Create JPEG stream
      const imageStream = canvas.createJPEGStream({
        bufsize: 4096,
        quality: 95,
        progressive: false,
      });
      const buf = await getBufferFromStream(imageStream);

      // Cleanup - wrap in try-catch as Three.js dispose may have browser-specific code
      try {
        renderer.dispose();
      } catch (disposeErr) {
        console.error("[mineflayer-mcp] Renderer dispose warning:", disposeErr);
      }

      if (output_path) {
        // Save to file
        const dir = output_path.substring(0, output_path.lastIndexOf('/'));
        if (dir) {
          try {
            await stat(dir);
          } catch {
            await mkdir(dir, { recursive: true });
          }
        }
        await writeFile(output_path, buf);
        console.error(`[mineflayer-mcp] Screenshot saved to ${output_path}`);
        return {
          content: [{ type: "text", text: `Screenshot saved to ${output_path}` }],
        };
      } else {
        // Return as base64
        const base64 = buf.toString("base64");
        console.error("[mineflayer-mcp] Screenshot captured, returning as base64");
        return {
          content: [
            {
              type: "image",
              data: base64,
              mimeType: "image/jpeg",
            },
          ],
        };
      }
    } catch (err: unknown) {
      const error = err as Error;
      console.error("[mineflayer-mcp] Screenshot error:", error);
      return {
        content: [{ type: "text", text: `Screenshot error: ${error.message}\n${error.stack}` }],
        isError: true,
      };
    }
  }
);

// ============================================================
// Minecraft Wiki Knowledge Base Tools
// ============================================================

// Initialize knowledge base on startup
initKnowledge().catch((err) => {
  console.error("[mineflayer-mcp] Knowledge base init error:", err.message);
});

// Tool: Search wiki using full-text search (FTS5)
server.tool(
  "wiki_search",
  "Search Minecraft wiki using full-text search. Good for finding specific terms, item names, mob names, etc.",
  {
    query: z.string().describe("Search query (e.g., 'zombie spawn conditions', 'diamond sword damage')"),
    limit: z.number().optional().describe("Maximum number of results (default: 5)"),
  },
  async ({ query, limit }) => {
    try {
      const results = await searchFullText(query, limit || 5);

      if (results.length === 0) {
        return {
          content: [{ type: "text", text: `No results found for: ${query}` }],
        };
      }

      const output = results.map((r, i) =>
        `${i + 1}. **${r.title}** (${r.category})\n   ${r.snippet.replace(/>>>/g, "**").replace(/<<</g, "**")}`
      ).join("\n\n");

      return {
        content: [{ type: "text", text: `Found ${results.length} results for "${query}":\n\n${output}` }],
      };
    } catch (err: any) {
      return {
        content: [{ type: "text", text: `Search error: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// Tool: Semantic search using embeddings
server.tool(
  "wiki_semantic_search",
  "Search Minecraft wiki using semantic/meaning-based search. Good for conceptual questions like 'how to survive at night' or 'best armor for the nether'.",
  {
    query: z.string().describe("Natural language query describing what you're looking for"),
    limit: z.number().optional().describe("Maximum number of results (default: 5)"),
  },
  async ({ query, limit }) => {
    try {
      const results = await searchSemantic(query, limit || 5);

      if (results.length === 0) {
        return {
          content: [{ type: "text", text: `No results found for: ${query}` }],
        };
      }

      const output = results.map((r, i) =>
        `${i + 1}. **${r.title}** (${r.category}) [score: ${r.score.toFixed(3)}]\n   ${r.snippet}`
      ).join("\n\n");

      return {
        content: [{ type: "text", text: `Found ${results.length} semantically similar results for "${query}":\n\n${output}` }],
      };
    } catch (err: any) {
      return {
        content: [{ type: "text", text: `Semantic search error: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// Tool: Hybrid search (combines FTS and semantic)
server.tool(
  "wiki_hybrid_search",
  "Search Minecraft wiki using both full-text and semantic search. Best for general queries when you want comprehensive results.",
  {
    query: z.string().describe("Search query - can be keywords or natural language"),
    limit: z.number().optional().describe("Maximum number of results (default: 5)"),
  },
  async ({ query, limit }) => {
    try {
      const results = await searchHybrid(query, limit || 5);

      if (results.length === 0) {
        return {
          content: [{ type: "text", text: `No results found for: ${query}` }],
        };
      }

      const output = results.map((r, i) =>
        `${i + 1}. **${r.title}** (${r.category})\n   ${r.snippet.replace(/>>>/g, "**").replace(/<<</g, "**")}`
      ).join("\n\n");

      return {
        content: [{ type: "text", text: `Found ${results.length} results for "${query}":\n\n${output}` }],
      };
    } catch (err: any) {
      return {
        content: [{ type: "text", text: `Hybrid search error: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// Tool: Get full wiki article
server.tool(
  "wiki_get",
  "Get the full content of a specific Minecraft wiki article by title.",
  {
    title: z.string().describe("Article title (e.g., 'Zombie', 'Diamond Sword', 'Crafting')"),
  },
  async ({ title }) => {
    try {
      const doc = await getDocument(title);

      if (!doc) {
        // Try fuzzy search
        const results = await searchFullText(title, 3);
        if (results.length > 0) {
          return {
            content: [{
              type: "text",
              text: `Article "${title}" not found. Did you mean:\n` +
                results.map(r => `- ${r.title}`).join("\n"),
            }],
          };
        }
        return {
          content: [{ type: "text", text: `Article not found: ${title}` }],
          isError: true,
        };
      }

      return {
        content: [{
          type: "text",
          text: `# ${doc.title}\n**Category:** ${doc.category}\n\n${doc.content}`,
        }],
      };
    } catch (err: any) {
      return {
        content: [{ type: "text", text: `Error getting article: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// Tool: List articles by category
server.tool(
  "wiki_list",
  "List all wiki articles in a category.",
  {
    category: z.string().optional().describe("Category name (mobs, items, blocks, mechanics, food, materials, enchantments, potions, structures, dimensions). If not specified, shows all categories."),
  },
  async ({ category }) => {
    try {
      const stats = await getStats();

      if (!category) {
        // List all categories
        const output = Object.entries(stats.categories)
          .sort((a, b) => b[1] - a[1])
          .map(([cat, count]) => `- **${cat}**: ${count} articles`)
          .join("\n");

        return {
          content: [{
            type: "text",
            text: `Wiki Categories (${stats.totalDocuments} total articles):\n\n${output}\n\nUse wiki_list with a category name to see articles.`,
          }],
        };
      }

      const articles = await listByCategory(category);

      if (articles.length === 0) {
        return {
          content: [{ type: "text", text: `No articles found in category: ${category}` }],
        };
      }

      return {
        content: [{
          type: "text",
          text: `Articles in **${category}** (${articles.length}):\n\n` +
            articles.map(a => `- ${a.title}`).join("\n"),
        }],
      };
    } catch (err: any) {
      return {
        content: [{ type: "text", text: `Error listing articles: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// Tool: Index/re-index the knowledge base
server.tool(
  "wiki_index",
  "Index or re-index the Minecraft wiki knowledge base. Use this if new wiki files have been added.",
  {
    force: z.boolean().optional().describe("Force re-index all documents (default: false, only indexes new files)"),
  },
  async ({ force }) => {
    try {
      const result = await indexSkills(force || false);
      const stats = await getStats();

      return {
        content: [{
          type: "text",
          text: `Indexing complete!\n- Indexed: ${result.indexed}\n- Skipped: ${result.skipped}\n- Total documents: ${stats.totalDocuments}\n- With embeddings: ${stats.hasEmbeddings}`,
        }],
      };
    } catch (err: any) {
      return {
        content: [{ type: "text", text: `Indexing error: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// Configuration
const MCP_PORT = parseInt(process.env.MCP_PORT || "3001");
const USE_HTTP = process.env.MCP_TRANSPORT === "http";

// Start the server
async function main() {
  if (USE_HTTP) {
    // HTTP transport for persistent server - stateless style
    // Each request creates a new transport but shares global bot state
    const app = express();
    app.use(express.json());

    app.post("/mcp", async (req, res) => {
      console.error(`[mineflayer-mcp] POST /mcp`);
      try {
        // Create new transport for each request (stateless mode)
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined, // Stateless - no sessions
        });

        // Clean up on close
        res.on("close", () => {
          console.error("[mineflayer-mcp] Request closed");
          transport.close();
        });

        // Connect and handle
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
      } catch (err: any) {
        console.error("[mineflayer-mcp] Error handling request:", err);
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: "2.0",
            error: { code: -32603, message: err.message },
            id: null,
          });
        }
      }
    });

    // GET and DELETE not supported in stateless mode
    app.get("/mcp", (_req, res) => {
      res.status(405).json({ error: "Method not allowed in stateless mode" });
    });

    app.delete("/mcp", (_req, res) => {
      res.status(405).json({ error: "Method not allowed in stateless mode" });
    });

    app.listen(MCP_PORT, () => {
      console.error(`[mineflayer-mcp] HTTP MCP server listening on port ${MCP_PORT}`);
    });
  } else {
    // Stdio transport for direct process communication
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }
}

main().catch(console.error);
