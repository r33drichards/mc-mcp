# Mineflayer MCP Server

An MCP (Model Context Protocol) server that provides tools for controlling a Minecraft bot using [mineflayer](https://github.com/PrismarineJS/mineflayer).

## Features

- **connect** - Connect bot to a Minecraft server
- **disconnect** - Disconnect from server
- **eval** - Execute arbitrary JavaScript with bot in scope
- **screenshot** - Capture screenshots from bot's perspective


## Installation

```bash
npm install
npm run build
```

## Usage

### With Claude Desktop

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "mineflayer": {
      "command": "node",
      "args": ["/path/to/mineflayer-mcp/dist/index.js"],
      "env": {
        "MC_HOST": "localhost",
        "MC_PORT": "25565",
        "MC_USERNAME": "claude-bot"
      }
    }
  }
}
```

### With MCP Inspector

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

### Standalone (stdio)

```bash
npm start
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MC_HOST` | `localhost` | Minecraft server host |
| `MC_PORT` | `25565` | Minecraft server port |
| `MC_USERNAME` | `mcp-bot` | Bot username |
| `MC_PASSWORD` | - | Bot password (for online-mode servers) |
| `SCREENSHOT_DIR` | `./screenshots` | Directory for screenshots |

## Tools

### `connect`

Connect the bot to a Minecraft server.

```json
{
  "host": "localhost",
  "port": 25565,
  "username": "my-bot"
}
```

### `disconnect`

Disconnect from the current server. No parameters.

### `eval`

Execute JavaScript code with the mineflayer bot in scope.

```json
{
  "code": "return bot.entity.position"
}
```

Available in scope:
- `bot` - The mineflayer Bot instance
- `Vec3` - The vec3 class for vector operations

Examples:
```javascript
// Get position
return bot.entity.position

// Get nearby players
return Object.keys(bot.players)

// Move forward
bot.setControlState('forward', true)
await new Promise(r => setTimeout(r, 1000))
bot.setControlState('forward', false)

// Look at entity
const player = bot.players['Steve']
if (player?.entity) bot.lookAt(player.entity.position)
```

### `screenshot`

Take a screenshot from the bot's perspective.

```json
{
  "name": "my_screenshot",
  "direction_x": 1,
  "direction_y": -0.2,
  "direction_z": 0
}
```

Direction components control where the camera looks relative to current position.

### `status`

Get current bot status. Returns:
- `connected` - Connection state
- `username` - Bot's username
- `position` - Current coordinates
- `health` - Health points
- `food` - Food level
- `gameMode` - Current game mode
- `dimension` - Current dimension
- `difficulty` - Server difficulty
- `time` - Time of day

### `chat`

Send a chat message.

```json
{
  "message": "Hello, world!"
}
```

### `move_to`

Look at a position (basic movement).

```json
{
  "x": 100,
  "y": 64,
  "z": 200
}
```

For advanced pathfinding, use `eval` with mineflayer-pathfinder:
```javascript
const { pathfinder, goals } = require('mineflayer-pathfinder')
bot.loadPlugin(pathfinder)
bot.pathfinder.goto(new goals.GoalBlock(100, 64, 200))
```

## Development

```bash
# Run in development mode with hot reload
npm run dev

# Build
npm run build

# Test with MCP inspector
npx @modelcontextprotocol/inspector npm run dev
```

## Notes

- The screenshot feature requires native OpenGL dependencies via `node-canvas-webgl`
- Screenshots take ~3 seconds to render while waiting for chunks
- The `eval` tool is powerful but use with care - it can execute arbitrary code
- For production, consider adding authentication/authorization

## License

MIT
