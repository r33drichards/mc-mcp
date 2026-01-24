#!/bin/bash

# Sub-Agent Runner: guide
# Runs Claude in a continuous OODA loop with MCP connection

cd "$(dirname "$0")"

AGENT_NAME="guide"
MCP_PORT="3255"
COMPOSE_FILE="docker-compose.yml"
LOG_FILE="agent.log"
PID_FILE="agent.pid"
MCP_CONFIG_FILE="mcp-config.json"

# Create MCP config file
create_mcp_config() {
  cat > "$MCP_CONFIG_FILE" << EOF
{
  "mcpServers": {
    "minecraft": {
      "type": "http",
      "url": "http://localhost:$MCP_PORT/mcp"
    }
  }
}
EOF
}

# Build prompt with current memories
build_prompt() {
  local prompt_content=$(cat prompt.md)
  local memories_content=$(cat memories.txt 2>/dev/null || echo "No memories yet.")

  # Use awk for safe substitution
  echo "$prompt_content" | awk -v mem="$memories_content" '{gsub(/\{\{MEMORIES\}\}/, mem); print}'
}

# Start the MCP container
start_container() {
  if ! docker ps --format '{{.Names}}' | grep -q "^mc-$AGENT_NAME\$"; then
    echo "[$AGENT_NAME] Starting MCP container..."
    docker compose -f "$COMPOSE_FILE" up -d
    sleep 3
  fi
}

# Stop the MCP container
stop_container() {
  echo "[$AGENT_NAME] Stopping MCP container..."
  docker compose -f "$COMPOSE_FILE" down 2>/dev/null || true
}

# Main loop
run_loop() {
  local iteration=0

  echo "[$AGENT_NAME] Starting agent loop..."
  echo "[$AGENT_NAME] MCP server: http://localhost:$MCP_PORT/mcp"
  echo "[$AGENT_NAME] Log file: $LOG_FILE"
  echo ""

  # Save PID for management
  echo $$ > "$PID_FILE"

  # Create MCP config
  create_mcp_config

  # Cleanup on exit
  trap 'echo "[$AGENT_NAME] Shutting down..."; stop_container; rm -f "$PID_FILE"; exit 0' INT TERM

  while true; do
    iteration=$((iteration + 1))
    timestamp=$(date '+%H:%M:%S')

    echo "=== [$AGENT_NAME] Iteration $iteration at $timestamp ===" | tee -a "$LOG_FILE"

    # Run Claude with MCP config file
    build_prompt | npx -y @anthropic-ai/claude-code -p \
      --dangerously-skip-permissions \
      --mcp-config "$MCP_CONFIG_FILE" \
      2>&1 | tee -a "$LOG_FILE"

    echo "" | tee -a "$LOG_FILE"

    # Brief pause between iterations
    sleep 2
  done
}

# Command handling
case "${1:-}" in
  start)
    start_container
    nohup "$0" _loop > /dev/null 2>&1 &
    echo "[$AGENT_NAME] Agent started in background (PID: $!)"
    ;;
  _loop)
    # Internal: run the actual loop (called by start)
    run_loop
    ;;
  stop)
    if [ -f "$PID_FILE" ]; then
      kill $(cat "$PID_FILE") 2>/dev/null || true
      rm -f "$PID_FILE"
    fi
    stop_container
    echo "[$AGENT_NAME] Agent stopped"
    ;;
  restart)
    ./run.sh stop
    sleep 1
    ./run.sh start
    ;;
  status)
    if [ -f "$PID_FILE" ] && kill -0 $(cat "$PID_FILE") 2>/dev/null; then
      echo "[$AGENT_NAME] Running (PID: $(cat "$PID_FILE"))"
    else
      echo "[$AGENT_NAME] Stopped"
    fi
    ;;
  logs)
    tail -f "$LOG_FILE"
    ;;
  run)
    # Foreground mode for debugging
    start_container
    run_loop
    ;;
  *)
    echo "Usage: $0 {start|stop|restart|status|logs|run}"
    echo ""
    echo "  start   - Start agent in background"
    echo "  stop    - Stop agent and container"
    echo "  restart - Restart agent"
    echo "  status  - Check if agent is running"
    echo "  logs    - Tail agent log"
    echo "  run     - Run in foreground (for debugging)"
    exit 1
    ;;
esac
