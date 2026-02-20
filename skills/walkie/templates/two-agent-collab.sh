#!/usr/bin/env bash
# Two-agent collaboration: coordinator sends a task, worker executes and reports back.
#
# For same-machine usage, set WALKIE_ID to give each agent a unique identity.
# For cross-machine usage, WALKIE_ID is optional (each machine has its own daemon).
#
# Usage:
#   Coordinator: ./two-agent-collab.sh coordinator <channel> <secret> "task description"
#   Worker:      ./two-agent-collab.sh worker <channel> <secret>
#
# Same-machine example:
#   WALKIE_ID=coordinator ./two-agent-collab.sh coordinator room secret "analyze data"
#   WALKIE_ID=worker ./two-agent-collab.sh worker room secret

set -euo pipefail

ROLE="${1:?Usage: $0 <coordinator|worker> <channel> <secret> [task]}"
CHANNEL="${2:?Channel name required}"
SECRET="${3:?Secret required}"

case "$ROLE" in
  coordinator)
    TASK="${4:?Task description required for coordinator}"
    walkie create "$CHANNEL" -s "$SECRET"
    echo "Waiting for peer to connect..."
    sleep 5  # Allow time for peer discovery
    walkie send "$CHANNEL" "$TASK"
    echo "Task sent. Waiting for result..."
    walkie read "$CHANNEL" --wait --timeout 120
    walkie leave "$CHANNEL"
    ;;
  worker)
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
