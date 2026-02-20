#!/usr/bin/env bash
# Same-machine collaboration: two agents on the same daemon using WALKIE_ID.
#
# Both agents share a single daemon. Messages are routed locally without
# going over the network. Each agent must have a unique WALKIE_ID.
#
# Usage:
#   Coordinator: ./same-machine-collab.sh coordinator <channel> <secret> "task"
#   Worker:      ./same-machine-collab.sh worker <channel> <secret>
#
# Example:
#   Terminal 1: ./same-machine-collab.sh coordinator task-room secret123 "analyze data.csv"
#   Terminal 2: ./same-machine-collab.sh worker task-room secret123

set -euo pipefail

ROLE="${1:?Usage: $0 <coordinator|worker> <channel> <secret> [task]}"
CHANNEL="${2:?Channel name required}"
SECRET="${3:?Secret required}"

case "$ROLE" in
  coordinator)
    TASK="${4:?Task description required for coordinator}"
    export WALKIE_ID=coordinator
    walkie create "$CHANNEL" -s "$SECRET"
    walkie send "$CHANNEL" "$TASK"
    echo "Task sent locally. Waiting for result..."
    walkie read "$CHANNEL" --wait --timeout 120
    walkie leave "$CHANNEL"
    ;;
  worker)
    export WALKIE_ID=worker
    walkie join "$CHANNEL" -s "$SECRET"
    echo "Joined channel. Waiting for task..."
    TASK=$(walkie read "$CHANNEL" --wait --timeout 60)
    echo "Received task: $TASK"
    echo "--- Execute your work here ---"
    walkie send "$CHANNEL" "done: task completed successfully"
    walkie leave "$CHANNEL"
    ;;
  *)
    echo "Unknown role: $ROLE (use 'coordinator' or 'worker')"
    exit 1
    ;;
esac
