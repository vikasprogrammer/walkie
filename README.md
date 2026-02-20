# walkie

P2P communication for AI agents. No server. No setup. Just talk.

```
npm install -g walkie-sh
```

## What is this?

AI agents are isolated. When two agents need to collaborate, there's no simple way for them to talk directly. Walkie gives them a walkie-talkie — pick a channel, share a secret, and they find each other automatically over the internet.

- **No server** — peer-to-peer via Hyperswarm DHT
- **No setup** — one install, two commands, agents are talking
- **Works anywhere** — same machine or different continents
- **Group channels** — connect 2, 5, or 50 agents on the same channel
- **Encrypted** — Noise protocol, secure by default
- **Agent-native** — CLI-first, any agent that runs shell commands can use it

## Quick start

**Agent A** (on any machine):
```bash
walkie create ops-room -s mysecret
walkie send ops-room "task complete, results ready"
```

**Agent B** (on any other machine, or a different terminal on the same machine):
```bash
walkie join ops-room -s mysecret
walkie read ops-room
# [14:30:05] a1b2c3d4: task complete, results ready
```

Works the same whether agents are on the same machine or different continents.

## Commands

```
walkie create <channel> -s <secret>   Create a channel
walkie join <channel> -s <secret>     Join a channel
walkie send <channel> "message"       Send a message
walkie read <channel>                 Read pending messages
walkie read <channel> --wait          Block until a message arrives
walkie status                         Show active channels & peers
walkie leave <channel>                Leave a channel
walkie stop                           Stop the daemon
```

Each terminal session gets a unique subscriber ID automatically. Set `WALKIE_ID` env var for human-readable sender names.

## How it works

```
Agent A                Agent B
┌────────┐             ┌────────┐
│ walkie │◄── P2P ────►│ walkie │
│ daemon │  encrypted   │ daemon │
└────────┘              └────────┘
```

1. Channel name + secret are hashed into a 32-byte topic
2. Both agents announce/lookup the topic on the Hyperswarm DHT
3. DHT connects them directly — no relay, no server
4. All communication is encrypted via the Noise protocol
5. A background daemon maintains connections so CLI commands are instant

## Use cases

- **Multi-agent collaboration** — agents coordinate tasks in real-time
- **Agent delegation** — one agent sends work to another and waits for results
- **Agent monitoring** — watch what your agents are doing from another terminal
- **Cross-machine pipelines** — chain agents across different servers

## Skill

Walkie ships with a [skill](skills/walkie/SKILL.md) so AI agents can use it out of the box.

```bash
npx skills add https://github.com/vikasprogrammer/walkie --skill walkie
```

Install the skill and any agent with shell access can create channels, send messages, and coordinate with other agents automatically.

## Changelog

### 1.3.0

- **Simplified CLI** — removed `--as` flag, `WALKIE_ID` env var is the only explicit identity option
- **Stale daemon recovery** — cleans up stale socket/PID files before spawning, better error messages

### 1.2.0

- **Auto-unique subscriber IDs** — each terminal session gets a unique ID automatically. Same-machine agents just work with no setup
- **`--wait` blocks indefinitely** — `walkie read --wait` blocks until a message arrives. Add `--timeout N` for a deadline

### 1.1.0

- **Same-machine multi-agent routing** — per-subscriber message buffers, senders never see their own messages
- `walkie status` shows subscriber count, `walkie leave` only tears down P2P when all subscribers leave

## License

MIT
