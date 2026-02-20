---
name: walkie
description: P2P communication between AI agents using walkie-sh CLI. Use when the user asks to set up agent-to-agent communication, create a walkie channel, send/receive messages between agents, or enable real-time coordination between multiple AI agents. Triggers on "walkie", "agent communication", "talk to another agent", "set up a channel", "inter-agent messaging".
allowed-tools: Bash(walkie:*)
---

# Walkie — Agent-to-Agent P2P Communication

Prerequisite: `npm install -g walkie-sh`

## Core Workflow

Every agent communication follows this pattern:

1. **Create/Join**: Both agents connect to the same channel with a shared secret
2. **Send**: Push messages to the channel
3. **Read**: Pull messages (non-blocking or blocking)
4. **Cleanup**: Leave the channel and stop the daemon when done

```bash
# Agent A (cross-machine: each machine has its own daemon)
walkie create ops-room -s mysecret
walkie send ops-room "task complete, results at /tmp/output.json"

# Agent B (different machine)
walkie join ops-room -s mysecret
walkie read ops-room
# [14:30:05] a1b2c3d4: task complete, results at /tmp/output.json
```

The sender ID is the remote daemon's 8-char hex ID for P2P messages. For same-machine messages, it shows the `WALKIE_ID` instead (e.g., `alice`).

## Essential Commands

```bash
# Channel management (create and join are functionally identical)
walkie create <channel> -s <secret>   # Create/join a channel
walkie join <channel> -s <secret>     # Join a channel (same as create)
walkie leave <channel>                # Remove your subscription from a channel
walkie stop                           # Stop the background daemon

# Messaging
walkie send <channel> "message"       # Send to all recipients (P2P peers + local subscribers)
walkie read <channel>                 # Read pending messages (non-blocking)
walkie read <channel> --wait          # Block until a message arrives or 30s elapses (exit 0 either way)
walkie read <channel> --wait --timeout 60  # Block with custom timeout

# Status
walkie status                         # Show channels, peers, subscribers, buffered messages
```

## Same-Machine Multi-Agent (WALKIE_ID)

When two agents share the same machine (same daemon), use `WALKIE_ID` or `--as` to give each agent a unique identity. Messages are routed locally without going over the network.

```bash
# Agent A
export WALKIE_ID=alice
walkie create ops-room -s mysecret
walkie send ops-room "task complete"

# Agent B (same machine)
export WALKIE_ID=bob
walkie join ops-room -s mysecret
walkie read ops-room
# [14:30:05] alice: task complete
```

**How it works:**
- Each `WALKIE_ID` gets its own message buffer in the daemon
- `send` delivers to P2P peers AND all other local subscribers (sender excluded)
- `delivered` count includes both P2P peers and local subscribers
- Without `WALKIE_ID` or `--as`, defaults to `"default"` (backward compatible)
- **Resolution order:** `--as` flag > `WALKIE_ID` env var > `"default"`

**Warning:** Each `WALKIE_ID` maps to a single buffer. If two processes use the same ID, one process will drain messages the other expected. Always use unique `WALKIE_ID`s for concurrent agents on the same machine.

## Group Channels

Any number of agents can share a channel — 2, 5, or 50. `send` delivers to all connected peers and all local subscribers simultaneously (true multicast). Every agent on the channel sees every message except their own.

```bash
# Three agents on the same machine
WALKIE_ID=alice walkie create room -s secret
WALKIE_ID=bob walkie join room -s secret
WALKIE_ID=charlie walkie join room -s secret

WALKIE_ID=alice walkie send room "hello everyone"
# bob and charlie both receive it; alice does not
```

## Continuous Listening

For autonomous agent-to-agent communication, loop on `walkie read --wait`:

```bash
while true; do
  MSG=$(walkie read <channel> --wait --timeout 120)
  if [ "$MSG" != "No new messages" ] && [ -n "$MSG" ]; then
    # Process and respond
    walkie send <channel> "response"
  fi
done
```

See [references/polling-patterns.md](references/polling-patterns.md) for task delegation, heartbeat, stop signal, request-response, and fan-out/fan-in patterns.

## Key Details

- **Daemon auto-starts** on first command, runs in background at `~/.walkie/`
- **Debug logs** are written to `~/.walkie/daemon.log`
- **`WALKIE_DIR`** env var overrides the daemon directory (default: `~/.walkie`)
- **Messages buffer locally** — `walkie read` drains the buffer, each message returned once
- **Fire-and-forget** — if `delivered: 0`, the message is permanently lost. No buffering for offline peers. Verify `delivered > 0` in critical workflows
- **Channel = hash(name + secret)** — both sides must use the same name and secret
- **Encrypted** — all P2P connections use the Noise protocol via Hyperswarm
- **Peer discovery** takes 1–15 seconds via DHT
- **No server** — fully peer-to-peer, works across machines and networks
- **Timestamp format** in `walkie read` output is locale-dependent — do not parse it by regex
- **`leave` with multiple subscribers** — only removes your subscription; channel stays alive for other local subscribers

## Recovery

If the daemon crashes, all buffered messages and channel subscriptions are lost. The daemon will auto-restart on the next CLI command, but agents must re-create/re-join channels. There is no message persistence.

## Cleanup

Always clean up when done to avoid leaked daemon processes:

```bash
walkie leave <channel>   # Leave specific channel
walkie stop              # Stop the daemon entirely
```

## Deep-Dive Documentation

| Reference | When to Use |
|-----------|-------------|
| [references/commands.md](references/commands.md) | Full command reference with all options and output formats |
| [references/architecture.md](references/architecture.md) | How the daemon, IPC, and P2P layers work |
| [references/polling-patterns.md](references/polling-patterns.md) | Agent polling strategies, multi-agent coordination patterns |

## Ready-to-Use Templates

| Template | Description |
|----------|-------------|
| [templates/two-agent-collab.sh](templates/two-agent-collab.sh) | Coordinator sends task, worker executes and reports back |
| [templates/same-machine-collab.sh](templates/same-machine-collab.sh) | Same-machine collaboration with WALKIE_ID |
| [templates/delegated-task.sh](templates/delegated-task.sh) | Delegate work to another agent and wait for result |
| [templates/monitoring.sh](templates/monitoring.sh) | Monitor agent activity (uses `--as monitor` to avoid stealing messages) |
