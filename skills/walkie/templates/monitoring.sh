#!/usr/bin/env bash
# Monitor agent activity on a channel from a separate terminal.
# Continuously polls for messages and prints them.
#
# IMPORTANT: Uses --as monitor to avoid stealing messages from the agents
# being monitored. Without a unique identity, reads would drain messages
# intended for the monitored agents.
#
# Usage: ./monitoring.sh <channel> <secret> [poll_interval_seconds]
#
# Example:
#   ./monitoring.sh ops-room mysecret 5

set -euo pipefail

CHANNEL="${1:?Channel name required}"
SECRET="${2:?Secret required}"
INTERVAL="${3:-3}"

walkie join "$CHANNEL" -s "$SECRET" --as monitor
echo "Monitoring channel: $CHANNEL (poll every ${INTERVAL}s)"
echo "Press Ctrl+C to stop"
echo "---"

trap 'echo ""; echo "Leaving channel..."; walkie leave "$CHANNEL" --as monitor; exit 0' INT TERM

while true; do
  MESSAGES=$(walkie read "$CHANNEL" --as monitor 2>/dev/null || true)
  if [ -n "$MESSAGES" ] && [ "$MESSAGES" != "No new messages" ]; then
    echo "$MESSAGES"
  fi
  sleep "$INTERVAL"
done
