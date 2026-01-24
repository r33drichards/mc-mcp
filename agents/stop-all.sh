#!/bin/bash

# Stop all running agents

AGENTS_DIR="$(dirname "$0")"

echo "Stopping all agents..."

for dir in "$AGENTS_DIR"/*/; do
  [ -d "$dir" ] || continue
  name=$(basename "$dir")
  [ "$name" = "template" ] && continue
  [ -x "$dir/run.sh" ] || continue

  echo "  Stopping $name..."
  "$dir/run.sh" stop 2>/dev/null || true
done

echo "Done."
