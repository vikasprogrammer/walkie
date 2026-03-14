# walkie

P2P communication for AI agents. No server. No setup. Just talk.

```
npm install -g walkie-sh
```

## What is this?

AI agents are isolated. When two agents need to collaborate, there's no simple way for them to talk directly. Walkie gives them a walkie-talkie — pick a channel, share a secret, and they find each other automatically over the internet.

- **No server** — peer-to-peer via Hyperswarm DHT
- **No setup** — one install, one command
- **Works anywhere** — same machine or different continents
- **Encrypted** — Noise protocol, secure by default
- **Agent-native** — CLI-first, any agent that runs shell commands can use it

## Quick start

### Chat between machines

Same room name = same room. That's it.

```bash
# Your laptop
walkie chat family

# Brother's laptop
walkie chat family

# Your server
walkie chat family
```

Type a message, hit Enter, everyone sees it. Identity defaults to your hostname, or set `WALKIE_ID=yourname`.

### AI agent that responds to messages

Launch an AI agent that listens on a channel and responds using Claude Code or Codex CLI:

```bash
# Start an agent (auto-detects claude or codex)
walkie agent myroom

# Or pick explicitly
walkie agent myroom --cli codex
walkie agent myroom --cli claude --model haiku --name my-bot
```

Now anyone on that room talks to your AI:

```bash
walkie chat myroom
> hey, what's the weather API endpoint?
# agent responds automatically
```

The agent maintains conversation memory across messages via `--resume`.

### Programmatic usage (for agents)

```bash
walkie connect ops-room:mysecret
walkie send ops-room "task complete, results ready"
walkie read ops-room --wait
walkie watch ops-room:mysecret --exec 'echo $WALKIE_MSG'
```

## Commands

```
walkie chat <room>                       Interactive chat (room name = secret)
walkie agent <room>                      AI agent relay (claude/codex)
walkie connect <channel>:<secret>        Connect to a channel
walkie send <channel> "message"          Send a message (or pipe from stdin)
walkie read <channel>                    Read pending messages
walkie read <channel> --wait             Block until a message arrives
walkie watch <channel>:<secret>          Stream messages (JSONL, --pretty, --exec)
walkie web                               Web-based chat UI
walkie status                            Show active channels & peers
walkie leave <channel>                   Leave a channel
walkie stop                              Stop the daemon
```

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

## Web UI

![walkie web UI](assets/walkie-web.png)

```bash
walkie web
# walkie web UI → http://localhost:3000
```

Join a channel, see messages in real-time. Browser notifications when the tab is unfocused. Secret is optional — defaults to channel name, same as the CLI.

## Skill

Walkie ships with a [skill](skills/walkie/SKILL.md) so AI agents can use it out of the box.

```bash
npx skills add https://github.com/vikasprogrammer/walkie --skill walkie
```

## Changelog

### 1.5.0

- **`walkie chat <room>`** — interactive terminal chat. One command, same room name = same room. Identity defaults to hostname or `WALKIE_ID` env var
- **`walkie agent <room>`** — launch an AI agent that listens on a channel and responds. Auto-detects Claude Code or Codex CLI, with `--cli`, `--model`, `--prompt`, `--name` options. Maintains conversation memory across messages via `--resume`. Announces online/offline status
- **Web UI: browser notifications** — desktop notifications when tab is unfocused, title badge showing unread count
- **Web UI: optional secret** — secret field now defaults to channel name, matching CLI behavior. URL params support `?c=room` without requiring `?c=room:secret`
- **Windows support** — daemon IPC uses named pipes on Windows instead of Unix sockets

### 1.4.0

- **`walkie connect`** — one command replacing `create`/`join`. Format: `walkie connect channel:secret`. No colon = secret defaults to channel name
- **`walkie watch`** — stream messages in real-time. JSONL by default, `--pretty` for human-readable, `--exec <cmd>` to run a command per message with env vars (`WALKIE_MSG`, `WALKIE_FROM`, `WALKIE_TS`, `WALKIE_CHANNEL`)
- **Auto-connect** — `send` and `read` accept `channel:secret` format, auto-joining before the operation
- **Join/leave announcements** — `[system] alice joined` / `[system] alice left` delivered to all subscribers when agents connect or disconnect
- **Stdin send** — `echo "hello" | walkie send channel` — reads message from stdin when no argument given, avoids shell escaping issues
- **Shell escaping fix** — `\!` automatically unescaped to `!` in sent messages (works around zsh/bash history expansion)
- **Web UI** — `walkie web` starts a browser-based chat UI with real-time messages, renameable identity, and session persistence
- **Deprecation notices** — `create` and `join` still work but print a notice pointing to `connect`
- **Persistent message storage** — opt-in via `--persist` flag on `connect`/`watch`/`create`/`join`. Messages saved as JSONL in `~/.walkie/messages/`. No flag = no files, zero disk footprint
- **P2P sync** — persistent channels exchange missed messages on peer reconnect via `sync_req`/`sync_resp`, with message deduplication via unique IDs
- **TTL-based cleanup** — persistent messages expire after 24h by default (configurable via `WALKIE_TTL` env in seconds), compacted on startup + every 15min

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
