#!/bin/bash

# Create a new Minecraft sub-agent from template
# Usage: ./create.sh <agent-name> [role-description]

set -e

AGENTS_DIR="$(dirname "$0")"
TEMPLATE_DIR="$AGENTS_DIR/template"

if [ -z "$1" ]; then
  echo "Usage: ./create.sh <agent-name> [role-description]"
  echo ""
  echo "Examples:"
  echo "  ./create.sh miner 'You are a mining specialist. Dig tunnels and gather ores.'"
  echo "  ./create.sh builder 'You are a builder. Construct structures when asked.'"
  echo "  ./create.sh guard 'You are a guard. Patrol and fight hostile mobs.'"
  echo "  ./create.sh guide 'You are a guide. Lead players to destinations.'"
  exit 1
fi

AGENT_NAME="$1"
AGENT_ROLE="${2:-A general purpose Minecraft bot that follows instructions.}"
AGENT_DIR="$AGENTS_DIR/$AGENT_NAME"

# Check if agent already exists
if [ -d "$AGENT_DIR" ]; then
  echo "Agent '$AGENT_NAME' already exists at $AGENT_DIR"
  echo "Use: ./agents/$AGENT_NAME/run.sh start"
  exit 1
fi

# Calculate unique ports based on agent name hash
# Base ports: 3100 for viewer, 3200 for MCP
HASH=$(echo -n "$AGENT_NAME" | md5sum | cut -c1-4)
HASH_NUM=$((16#$HASH % 100))
VIEWER_PORT=$((3100 + HASH_NUM))
MCP_PORT=$((3200 + HASH_NUM))

echo "Creating agent: $AGENT_NAME"
echo "  Role: $AGENT_ROLE"
echo "  Viewer port: $VIEWER_PORT"
echo "  MCP port: $MCP_PORT"

# Create agent directory
mkdir -p "$AGENT_DIR"

# Copy and substitute template files
for file in prompt.md docker-compose.yml run.sh; do
  sed -e "s|{{AGENT_NAME}}|$AGENT_NAME|g" \
      -e "s|{{AGENT_ROLE}}|$AGENT_ROLE|g" \
      -e "s|{{VIEWER_PORT}}|$VIEWER_PORT|g" \
      -e "s|{{MCP_PORT}}|$MCP_PORT|g" \
      "$TEMPLATE_DIR/$file" > "$AGENT_DIR/$file"
done

chmod +x "$AGENT_DIR/run.sh"

# Create initial memories file
cat > "$AGENT_DIR/memories.txt" << EOF
## Current Task
No task assigned yet. Waiting for instructions.

## Known Locations
(none yet)

## Notes
(none yet)
EOF

# Create empty log file
touch "$AGENT_DIR/agent.log"

echo ""
echo "Agent '$AGENT_NAME' created at: $AGENT_DIR"
echo ""
echo "Commands:"
echo "  ./agents/$AGENT_NAME/run.sh start   - Start agent in background"
echo "  ./agents/$AGENT_NAME/run.sh stop    - Stop agent"
echo "  ./agents/$AGENT_NAME/run.sh logs    - View agent logs"
echo "  ./agents/$AGENT_NAME/run.sh status  - Check if running"
echo ""
echo "Edit memories.txt to give the agent tasks:"
echo "  vim ./agents/$AGENT_NAME/memories.txt"
