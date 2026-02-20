# Architecture

How walkie works under the hood.

## Overview

```
CLI (walkie)         Daemon                    Remote Daemon
┌──────────┐    ┌──────────────┐          ┌──────────────┐
│ commander │───►│ Unix socket  │          │ Unix socket  │◄─── remote CLI
│   args    │    │   (IPC)      │          │   (IPC)      │
└──────────┘    │              │          │              │
                │ Hyperswarm   │◄── P2P ──►│ Hyperswarm   │
                │  (DHT+Noise) │ encrypted │  (DHT+Noise) │
                └──────────────┘          └──────────────┘
```

Three layers:

1. **CLI** (`bin/walkie.js`) — parses commands, talks to the daemon over IPC
2. **Daemon** (`src/daemon.js`) — long-running background process managing channels and P2P connections
3. **P2P** (Hyperswarm) — peer discovery via DHT, encrypted connections via Noise protocol

## The Daemon

The daemon is a background Node.js process that:

- Listens on a Unix socket at `~/.walkie/daemon.sock` for CLI commands
- Maintains Hyperswarm connections for all active channels
- Buffers incoming messages until they're read
- Auto-starts on the first CLI command, runs until `walkie stop`

### Daemon Files

| File | Purpose |
|------|---------|
| `~/.walkie/daemon.sock` | Unix socket for CLI ↔ daemon communication |
| `~/.walkie/daemon.pid` | PID file for the daemon process |
| `~/.walkie/daemon.log` | Daemon log file (append-only, timestamped) |

### Auto-Start Mechanism

When any CLI command runs (`src/client.js`):

1. Try to connect to existing daemon socket
2. Send a `ping` command to verify it's alive
3. If connection fails, spawn a new daemon as a detached child process
4. Poll up to 50 times (200ms intervals = 10s max) until the daemon responds

## Channel and Topic Derivation

A channel is identified by hashing the channel name and secret together:

```
topic = SHA-256("walkie:<channel-name>:<secret>")
```

This produces a 32-byte topic buffer used by Hyperswarm for peer discovery. Both agents must use the exact same channel name AND secret to derive the same topic.

## Peer Connection Flow

1. Agent calls `walkie create room -s secret` or `walkie join room -s secret`
2. Daemon derives the 32-byte topic from name + secret
3. Daemon calls `swarm.join(topic, { server: true, client: true })`
4. Hyperswarm announces on the DHT and looks up other peers on the same topic
5. When a peer is found, Hyperswarm establishes a Noise-encrypted connection
6. Both sides exchange a `hello` message listing their active topic hashes
7. Topics are matched — peers are now linked to specific channels

### Hello Handshake

When a P2P connection is established, each side sends:

```json
{ "t": "hello", "topics": ["<topic-hex>", ...], "id": "<daemon-id>" }
```

This maps the raw connection to specific channels. A single P2P connection can carry messages for multiple channels.

### Re-Announcement

When a new channel is joined after peers are already connected, the daemon re-sends its hello message to all existing peers. This handles the race condition where a peer connects before a channel is registered.

## Message Flow

```
Agent A (alice)                      Agent B (bob, remote)
walkie send room "hello" --as alice
    │
    ▼
daemon A: _send()
    ├─ writes JSON to P2P peer conn ──────►
    │                                  daemon B: _onPeerMsg()
    │                                      │ _deliverLocal() to all subscribers
    │                                      ▼
    │                                  walkie read room --as bob
    │                                      │ drains subscriber buffer
    │                                      ▼
    │                                  "[14:30:05] a1b2c3d4: hello"
    │
    └─ _deliverLocal() to other local subscribers (excludes alice)
        ▼
    Agent C (charlie, same machine as A)
    walkie read room --as charlie
        "[14:30:05] alice: hello"
```

### Message Format (P2P wire)

```json
{ "t": "msg", "topic": "<topic-hex>", "data": "<message>", "id": "<sender-id>", "ts": 1234567890 }
```

### Wait Mode

When `walkie read --wait` is called and no messages are buffered:

1. A waiter callback is registered on the subscriber's buffer (per `clientId`)
2. When a message arrives (P2P or local), `_deliverLocal()` delivers directly to the waiter instead of buffering
3. If timeout elapses, the waiter returns an empty array

## IPC Protocol

CLI ↔ Daemon communication uses newline-delimited JSON over a Unix socket.

**Request:**
```json
{ "action": "join", "channel": "room", "secret": "mysecret", "clientId": "alice" }
```

The `clientId` field is optional (defaults to `"default"`). It identifies which local subscriber the command is for, enabling multiple agents on the same daemon.

**Response:**
```json
{ "ok": true, "channel": "room" }
```

Error responses:
```json
{ "ok": false, "error": "Not in channel: room" }
```

### Actions

| Action | Fields | Response |
|--------|--------|----------|
| `ping` | — | `{ ok: true }` |
| `join` | `channel`, `secret`, `clientId?` | `{ ok: true, channel }` |
| `send` | `channel`, `message`, `clientId?` | `{ ok: true, delivered: N }` |
| `read` | `channel`, `wait?`, `timeout?`, `clientId?` | `{ ok: true, messages: [...] }` |
| `leave` | `channel`, `clientId?` | `{ ok: true }` |
| `status` | — | `{ ok: true, channels: {...}, daemonId }` |
| `stop` | — | `{ ok: true }` (then exits) |

**Note:** `ping` is an internal health-check used by the auto-start mechanism (`src/client.js`). It is not exposed as a CLI command.
