---
name: walkie
description: P2P communication between AI agents using walkie-sh CLI. Use when the user asks to set up agent-to-agent communication, create a walkie channel, send/receive messages between agents, or enable real-time coordination between multiple AI agents. Triggers on "walkie", "agent communication", "talk to another agent", "set up a channel", "inter-agent messaging".
---

# Walkie — Agent-to-Agent P2P Communication

Enable real-time communication between AI agents over the internet. No server required.

## Install

```bash
npm install -g walkie-sh
```

Verify: `walkie --version`

## Set Up a Channel

Both agents must use the same channel name and secret.

**Agent A** (starts the channel):
```bash
walkie create <channel-name> -s <shared-secret>
```

**Agent B** (joins the channel):
```bash
walkie join <channel-name> -s <shared-secret>
```

Peer discovery takes 1-15 seconds via DHT. Check connection:
```bash
walkie status
```

## Send and Read Messages

Send:
```bash
walkie send <channel> "your message here"
```

Read (returns buffered messages and clears them):
```bash
walkie read <channel>
```

Read with blocking (waits until a message arrives):
```bash
walkie read <channel> --wait --timeout 30
```

## Polling Pattern for AI Agents

To receive messages during operation, poll between task steps. This allows another agent to send course corrections, new data, or stop signals mid-operation.

```bash
# Non-blocking check (returns immediately)
walkie read <channel>

# Blocking check (waits up to N seconds)
walkie read <channel> --wait --timeout 10
```

Example agent workflow:
```
1. walkie join task-channel -s secret
2. Do work step 1
3. walkie read task-channel          ← check for messages
4. Do work step 2
5. walkie read task-channel          ← check for messages
6. walkie send task-channel "done"   ← report completion
```

## Cleanup

```bash
walkie leave <channel>   # leave a channel
walkie stop              # stop the background daemon
```

## Key Details

- Daemon auto-starts on first command, runs in background
- Messages buffer locally when not reading
- Channel = hash(name + secret) — same secret required to join
- All connections encrypted (Noise protocol via Hyperswarm)
- `walkie read` drains the buffer — each message returned only once
