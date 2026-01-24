# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Mineflayer MCP Server - An MCP (Model Context Protocol) server that provides tools for controlling a Minecraft bot using mineflayer. The server exposes tools via stdio transport for integration with Claude Desktop or other MCP clients.

## Documentation Resources

Reference these local docs when you need to learn how to do something:

- **`minecraft.wiki/pages/`** - Full Minecraft Wiki (~47k pages of wikitext). Search for game mechanics, items, mobs, crafting recipes, redstone, etc.
  - Files are named like `Creeper.wiki`, `Diamond_Sword.wiki`, `Redstone_circuits.wiki`
  - Use grep to search: `grep -r "pattern" minecraft.wiki/pages/`

- **`mineflayer/`** - Mineflayer library source code and docs. Reference for bot API, events, methods.
  - `mineflayer/docs/` - API documentation
  - `mineflayer/lib/` - Source code for understanding internals
  - `mineflayer/examples/` - Example bot scripts

When unsure how to do something in Minecraft or with the bot, **search these docs first** before guessing.

## Commands

```bash
# Install dependencies
npm install

# Build TypeScript to dist/
npm run build

# Run in development mode (uses tsx for hot reload)
npm run dev

# Run production build
npm start

# Test with MCP inspector
npx @modelcontextprotocol/inspector node dist/index.js
npx @modelcontextprotocol/inspector npm run dev
```

## Architecture

Single-file MCP server (`src/index.ts`) that:

1. **Bot State Management**: Global `bot` and `botReady` variables track the mineflayer Bot instance and connection state
2. **Task System**: Background task execution with `tasks` Map storing Task objects (id, code, status, result/error, AbortController)
3. **MCP Tools**: Each tool is registered via `server.tool()` with Zod schemas for parameter validation

### MCP Tools Exposed

- `connect` - Creates mineflayer bot, loads pathfinder plugin, waits for chunks
- `disconnect` - Ends bot session
- `eval` - Executes arbitrary JS with bot context (sync or background mode)
- `eval_file` - Same as eval but loads code from file
- `get_task` / `list_tasks` / `cancel_task` - Background task management

### Eval Context

Code executed via `eval` has access to:
- `bot` - mineflayer Bot instance
- `goals` - pathfinder goals (GoalFollow, GoalNear, GoalBlock, GoalXZ, GoalY, GoalGetToBlock)
- `Movements` - pathfinder Movements class
- `mcData` - minecraft-data for the connected server version
- `Vec3` - vec3 class for vector operations
- `signal` - AbortSignal for background tasks

**IMPORTANT**: Use `return` to get results from eval. Example:
```js
// Wrong - returns undefined
bot.health

// Correct - returns the value
return bot.health

// Correct - return object
return { health: bot.health, food: bot.food }
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MC_HOST` | localhost | Minecraft server host |
| `MC_PORT` | 25565 | Minecraft server port |
| `MC_USERNAME` | mcp-bot | Bot username |
| `MC_PASSWORD` | - | For online-mode servers |
| `MC_AUTH` | microsoft | Auth mode: offline or microsoft |

## Minecraft Server

Connect to: `localhost:25565` (offline auth, from docker-compose)

## CRITICAL: On Session Start

**IMMEDIATELY do this OODA loop to ensure survival:**

1. **Connect**: `connect(host="localhost", port=25565, auth="offline")`

2. **Observe** - Check status:
```js
return {
  health: bot.health,
  food: bot.food,
  pos: bot.entity.position,
  time: bot.time.timeOfDay,
  isNight: bot.time.timeOfDay >= 13000,
  nearbyHostiles: Object.values(bot.entities).filter(e =>
    ['zombie','skeleton','spider','creeper','enderman','witch','phantom','drowned'].includes(e.name) &&
    e.position && bot.entity.position.distanceTo(e.position) < 16
  ).map(e => ({name: e.name, dist: bot.entity.position.distanceTo(e.position).toFixed(1)}))
}
```

3. **Orient/Decide/Act** based on threats:
   - **Hostiles nearby?** → Fight (if healthy) or flee
   - **Low health (<10)?** → Find safety, eat golden apples
   - **Low food (<14)?** → Eat immediately
   - **Night time?** → Find/make shelter or bed

4. **Start survival background task**:
```
eval_file("/usr/src/app/state/survival.js", background=true)
```

## Survival Scripts

The `state/` directory (mounted at `/usr/src/app/state/` in Docker) contains:

- **`survival.js`** - Main all-in-one survival manager (recommended) - handles eating, fighting/fleeing, sleeping
- **`eat.js`** - Standalone hunger management
- **`defend.js`** - Standalone mob defense/flee
- **`sleep.js`** - Standalone sleep at night

## Quick Survival Commands

```js
// Eat food
const food = bot.inventory.items().find(i => i.foodPoints);
if (food) { await bot.equip(food, 'hand'); await bot.consume(); }

// Flee (sprint away)
bot.setControlState('forward', true);
bot.setControlState('sprint', true);
await new Promise(r => setTimeout(r, 3000));
bot.clearControlStates();

// Attack nearest hostile
const hostile = Object.values(bot.entities).find(e =>
  ['zombie','skeleton','spider'].includes(e.name) &&
  e.position && bot.entity.position.distanceTo(e.position) < 5
);
if (hostile) await bot.attack(hostile);
```

## Sub-Agents

The `agents/` directory provides a system for spawning autonomous Claude-controlled bots. Each agent:
- Runs in a continuous OODA loop (like you!)
- Has its own Docker container and MCP server
- Connects to the same Minecraft server with a unique username
- Can be given tasks via `memories.txt`

### Quick Start

```bash
# Create an agent
./agents/create.sh guard "You are a bodyguard. Follow lmoik and attack hostile mobs."

# Give it a task (edit memories.txt)
vim agents/guard/memories.txt

# Start the agent
./agents/guard/run.sh start

# Check status
./agents/guard/run.sh status

# View logs
./agents/guard/run.sh logs

# Stop the agent
./agents/guard/run.sh stop
```

### Management Commands

Each agent has a `run.sh` with these commands:

| Command | Description |
|---------|-------------|
| `start` | Start agent loop in background |
| `stop` | Stop agent and container |
| `restart` | Restart agent |
| `status` | Check if agent is running |
| `logs` | Tail the agent's log file |
| `run` | Run in foreground (for debugging) |

### Global Commands

```bash
./agents/list.sh      # List all agents and status
./agents/stop-all.sh  # Stop all running agents
```

### Directory Structure

```
agents/
├── create.sh          # Create new agent from template
├── list.sh            # List all agents and status
├── stop-all.sh        # Stop all agents
├── template/          # Template files
│   ├── prompt.md      # Agent prompt template
│   ├── run.sh         # Runner script template
│   └── docker-compose.yml
└── <agent-name>/      # Created agents
    ├── prompt.md          # Agent's system prompt
    ├── memories.txt       # Agent's task and memory (edit this!)
    ├── run.sh             # Agent runner script
    ├── agent.log          # Output log
    ├── agent.pid          # PID file when running
    ├── mcp-config.json    # MCP config (auto-generated)
    └── docker-compose.yml # Container config
```

### How It Works

1. `create.sh` copies the template and assigns unique ports
2. `run.sh start` launches the Docker container (MCP server)
3. A background loop runs: `while true; cat prompt.md | claude -p; done`
4. Each iteration, Claude reads the prompt (with memories.txt injected)
5. Claude takes ONE action, then exits; loop continues
6. Edit `memories.txt` to change the agent's task

### Giving Tasks to Agents

Edit `agents/<name>/memories.txt`:

```markdown
## Current Task
Follow lmoik and attack hostile mobs within 8 blocks.

## Known Locations
- Base: X=100, Y=64, Z=200

## Notes
- Hostiles: zombie, skeleton, spider, creeper
- Stay within 3 blocks of lmoik
```

The agent reads this on every loop iteration and acts accordingly.

### Ports

Each agent gets unique ports based on its name:
- Viewer port: 3100-3199
- MCP port: 3200-3299

### Example Agents

```bash
# Bodyguard - follows and protects a player
./agents/create.sh guard "Follow lmoik and attack hostile mobs."

# Miner - gathers resources
./agents/create.sh miner "Mine stone and ores. Store in chests."

# Builder - constructs structures
./agents/create.sh builder "Build structures when given blueprints."

# Farmer - food production
./agents/create.sh farmer "Plant and harvest crops. Keep food stocked."
```
