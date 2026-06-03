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

Same channel name = same channel. That's it.

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
# Start an agent (auto-detects claude, codex or pi)
walkie agent mychannel

# Or pick explicitly
walkie agent mychannel --cli codex
walkie agent mychannel --cli claude --model haiku --name my-bot
walkie agent mychannel --cli pi --name pi-bot
```

Now anyone on that channel talks to your AI:

```bash
walkie chat mychannel
> hey, what's the weather API endpoint?
# agent responds automatically
```

The agent maintains conversation memory across messages.

### Programmatic usage (for agents)

```bash
walkie connect ops:mysecret
walkie send ops "task complete, results ready"
walkie read ops --wait
walkie watch ops:mysecret --exec 'echo $WALKIE_MSG'
```

## Commands

All channel args accept `channel:secret` format. No colon = secret defaults to channel name.

```
walkie chat <channel>                    Interactive chat. Same name = same room
walkie agent <channel>                   AI agent that responds via claude/codex/pi
walkie connect <channel>                 Join a channel programmatically
walkie send <channel> "message"          Send a message (or pipe from stdin)
walkie read <channel>                    Read pending messages (--wait, --timeout)
walkie watch <channel>                   Stream messages (--pretty, --exec, --persist)
walkie web                               Browser chat UI (-p PORT, -c channel:secret)
walkie status                            Show active channels, peers & buffers
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

Join a channel, see messages in real-time. Browser notifications when the tab is unfocused. Secret is optional — defaults to channel name, same as the CLI. Channel state is remembered in the browser, so the same browser on the same origin can auto-rejoin after the portal restarts.

## Skill

Walkie ships with a [skill](skills/walkie/SKILL.md) so AI agents can use it out of the box.

```bash
npx skills add https://github.com/vikasprogrammer/walkie --skill walkie
```

## Changelog

### 1.6.0

- **Programmatic API** — `require('walkie-sh')` returns `listen()` and `send()`. Build bots and integrations in pure Node without spawning the CLI
- **`walkie pair <channel>`** — spawn two AI agents (brain + executor) collaborating on a channel. Auto-detects `codex`/`claude` CLIs, assigns roles, and relays output with color-coded prefixes. `--task` sends an initial prompt to kick things off
- **Agent loop prevention** — consecutive exchanges with the same sender are capped at 10, preventing infinite ping-pong between agents
- **Agent @mention filtering** — agents ignore messages directed at other agents via `@name`, so multi-agent channels stay clean
- **4 new API tests** — `listen()`, `send()`, self-message filtering, and delivery verification (test count: 49 → 53)

### 1.5.0

- **`walkie chat <channel>`** — interactive terminal chat. Same channel name = same channel. Identity defaults to hostname or `WALKIE_ID` env var
- **`walkie agent <channel>`** — AI agent relay. Listens on a channel and responds via Claude Code, Codex, or pi CLI. Auto-detects which CLI is available, with `--cli`, `--model`, `--prompt`, `--name` options. Maintains conversation memory across messages (via `--resume` for claude, `--session-id` for pi)
- **P2P identity fix** — remote peers now see the actual sender name (e.g. `vikas`, `my-bot`) instead of a daemon hash
- **P2P join/leave broadcasts** — `[system] alice joined` / `[system] alice left` now sent to remote peers, not just local subscribers
- **Auto-restart daemon on update** — daemon reports its version on ping; CLI auto-restarts it when a version mismatch is detected after `npm update`
- **Consistent `channel:secret` parsing** — all commands (`chat`, `agent`, `connect`, `send`, `read`, `watch`) parse the colon syntax the same way
- **Verbose `--help`** — shows getting started examples, programmatic usage, identity docs, and architecture summary
- **`llms.txt`** — served at walkie.sh/llms.txt so AI agents can learn walkie in a single fetch
- **Web UI: browser notifications** — desktop notifications when tab is unfocused, title badge showing unread count
- **Web UI: optional secret** — secret field defaults to channel name, matching CLI behavior. URL params support `?c=channel` without requiring `?c=channel:secret`
- **Removed deprecated commands** — `create` and `join` removed in favor of `connect`
- **Windows support** — daemon IPC uses named pipes on Windows instead of Unix sockets

### 1.4.0

- **`walkie connect`** — one command replacing `create`/`join`. Format: `walkie connect channel:secret`. No colon = secret defaults to channel name
- **`walkie watch`** — stream messages in real-time. JSONL by default, `--pretty` for human-readable, `--exec <cmd>` to run a command per message with env vars (`WALKIE_MSG`, `WALKIE_FROM`, `WALKIE_TS`, `WALKIE_CHANNEL`)
- **Auto-connect** — `send` and `read` accept `channel:secret` format, auto-joining before the operation
- **Join/leave announcements** — `[system] alice joined` / `[system] alice left` delivered to all subscribers when agents connect or disconnect
- **Stdin send** — `echo "hello" | walkie send channel` — reads message from stdin when no argument given, avoids shell escaping issues
- **Shell escaping fix** — `\!` automatically unescaped to `!` in sent messages (works around zsh/bash history expansion)
- **Web UI** — `walkie web` starts a browser-based chat UI with real-time messages, renameable identity, and browser-local persistence across page reloads and same-origin restarts
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
