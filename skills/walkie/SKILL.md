---
name: walkie
description: P2P communication between AI agents using walkie-sh CLI. Use when the user asks to set up agent-to-agent communication, create a walkie channel, send/receive messages between agents, or enable real-time coordination between multiple AI agents. Triggers on "walkie", "agent communication", "talk to another agent", "set up a channel", "inter-agent messaging", "collaborate with", "coordinate with".
allowed-tools: Bash(walkie:*)
---

# Walkie — Agent-to-Agent Communication

## Before You Start

**Always set your identity first.** Before running any walkie command, pick a short name for yourself (based on your role — e.g., `alice`, `coder`, `reviewer`, `coordinator`) and export it:

```bash
export WALKIE_ID=<your-name>
```

This is required when another agent is on the same machine. Without it, messages between local agents will not be delivered. Do this even if the user doesn't mention it — it is always safe and prevents silent failures.

**Check that walkie is installed.** If `walkie --version` fails, run `npm install -g walkie-sh` first.

## Step-by-Step: Communicate with Another Agent

1. **Set your identity:** `export WALKIE_ID=<your-name>`
2. **Create or join a channel:** `walkie create <channel> -s <secret>` (use `create` if you're first, `join` if the other agent already created it — they're functionally identical)
3. **Send messages:** `walkie send <channel> "your message"`
4. **Read messages:** `walkie read <channel>` (non-blocking) or `walkie read <channel> --wait` (blocks until a message arrives, 30s default)
5. **Clean up when done:** `walkie leave <channel>`

### Example: Two agents on the same machine

```bash
# You (alice) — create channel and send a message
export WALKIE_ID=alice
walkie create ops-room -s mysecret
walkie send ops-room "task complete, results at /tmp/output.json"

# The other agent (bob) — join and read
export WALKIE_ID=bob
walkie join ops-room -s mysecret
walkie read ops-room
# [14:30:05] alice: task complete, results at /tmp/output.json
```

### Example: Waiting for a response

```bash
walkie send ops-room "what is the status?"
walkie read ops-room --wait --timeout 60
# Blocks until a reply arrives or 60 seconds elapse (returns "No new messages" on timeout, exit 0)
```

## Commands

```bash
walkie create <channel> -s <secret>        # Create/join a channel
walkie join <channel> -s <secret>          # Join a channel (same as create)
walkie send <channel> "message"            # Send to all recipients
walkie read <channel>                      # Read pending messages (non-blocking)
walkie read <channel> --wait               # Block until a message arrives (30s default)
walkie read <channel> --wait --timeout 60  # Block with custom timeout
walkie leave <channel>                     # Remove your subscription
walkie status                              # Show channels, peers, subscribers
walkie stop                                # Stop the daemon
```

## Important Behavior

- **Set WALKIE_ID before every session.** Two agents with the same ID share one buffer — one will steal the other's messages.
- **`delivered: 0` means the message is lost.** There is no retry or persistence. Verify `delivered > 0` in critical workflows.
- **`read` drains the buffer.** Each message is returned only once.
- **Sender never sees their own messages.** This is by design.
- **`leave` only removes your subscription.** The channel stays alive for other local subscribers.
- **Daemon auto-starts** on first command. Runs in background at `~/.walkie/`.
- **If the daemon crashes**, all buffered messages and subscriptions are lost. It auto-restarts on the next command, but you must re-join channels.
- **Debug logs** are at `~/.walkie/daemon.log`.

## Deep-Dive Documentation

| Reference | When to Use |
|-----------|-------------|
| [references/commands.md](references/commands.md) | Full command reference with all options and output formats |
| [references/architecture.md](references/architecture.md) | How the daemon, IPC, and P2P layers work |
| [references/polling-patterns.md](references/polling-patterns.md) | Agent polling strategies, multi-agent coordination patterns |

## Templates

| Template | Description |
|----------|-------------|
| [templates/same-machine-collab.sh](templates/same-machine-collab.sh) | Same-machine collaboration with WALKIE_ID |
| [templates/two-agent-collab.sh](templates/two-agent-collab.sh) | Coordinator sends task, worker executes and reports back |
| [templates/delegated-task.sh](templates/delegated-task.sh) | Delegate work to another agent and wait for result |
| [templates/monitoring.sh](templates/monitoring.sh) | Monitor agent activity (uses `--as monitor` to avoid stealing messages) |
