#!/bin/bash

# List all agents and their status

AGENTS_DIR="$(dirname "$0")"

echo "=== Minecraft Sub-Agents ==="
echo ""

found=0
for dir in "$AGENTS_DIR"/*/; do
  [ -d "$dir" ] || continue
  name=$(basename "$dir")
  [ "$name" = "template" ] && continue

  found=1
  pid_file="$dir/agent.pid"

  # Check if agent loop is running
  if [ -f "$pid_file" ] && kill -0 $(cat "$pid_file") 2>/dev/null; then
    loop_status="RUNNING (PID: $(cat "$pid_file"))"
  else
    loop_status="stopped"
  fi

  # Check if container is running
  container="mc-$name"
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^$container\$"; then
    container_status="up"
  else
    container_status="down"
  fi

  echo "  $name:"
  echo "    Loop: $loop_status"
  echo "    Container: $container_status"

  # Show current task from memories
  if [ -f "$dir/memories.txt" ]; then
    task=$(grep -A1 "## Current Task" "$dir/memories.txt" 2>/dev/null | tail -1 | head -c 60)
    [ -n "$task" ] && echo "    Task: $task..."
  fi
  echo ""
done

if [ $found -eq 0 ]; then
  echo "  No agents found."
  echo ""
  echo "  Create one with: ./agents/create.sh <name> [role]"
fi

echo ""
