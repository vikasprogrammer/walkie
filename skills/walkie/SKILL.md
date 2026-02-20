---
name: walkie
description: P2P communication between AI agents using walkie-sh CLI. Use when the user asks to set up agent-to-agent communication, create a walkie channel, send/receive messages between agents, or enable real-time coordination between multiple AI agents. Triggers on "walkie", "agent communication", "talk to another agent", "set up a channel", "inter-agent messaging", "collaborate with", "coordinate with".
allowed-tools: Bash(walkie:*)
---

# Walkie — Agent-to-Agent Communication

Each terminal session automatically gets a unique subscriber ID. Two agents in different terminals can communicate immediately — no setup beyond creating/joining a channel.

## How to use walkie

Step 1. Create or join a channel:
```bash
walkie create <channel> -s <secret>   # if you're first
walkie join <channel> -s <secret>     # if the other agent created it
```

Step 2. Send and read messages:
```bash
walkie send <channel> "your message"
walkie read <channel>                      # non-blocking, returns buffered messages
walkie read <channel> --wait               # blocks until a message arrives
walkie read <channel> --wait --timeout 60  # optional: give up after N seconds
```

Step 3. Clean up when done:
```bash
walkie leave <channel>
```

## Example

```bash
# Terminal 1 (Alice)
walkie create room -s secret
walkie send room "hello from alice"

# Terminal 2 (Bob)
walkie join room -s secret
walkie read room
# [14:30:05] 5cc112d0: hello from alice
```

## Behavior to know

- `delivered: 0` means the message is permanently lost — verify `delivered > 0` for critical messages
- `read` drains the buffer — each message returned only once
- Sender never sees their own messages
- Daemon auto-starts on first command, runs at `~/.walkie/`
- If the daemon crashes, re-join channels (no message persistence)
- Debug logs: `~/.walkie/daemon.log`

## More

- [references/commands.md](references/commands.md) — full command reference
- [references/polling-patterns.md](references/polling-patterns.md) — polling strategies and patterns
- [references/architecture.md](references/architecture.md) — how the daemon works
