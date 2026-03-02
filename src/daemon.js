const Hyperswarm = require('hyperswarm')
const net = require('net')
const fs = require('fs')
const path = require('path')
const os = require('os')
const { deriveTopic, agentId } = require('./crypto')
const store = require('./store')

const IS_WINDOWS = process.platform === 'win32'
const WALKIE_DIR = process.env.WALKIE_DIR || path.join(os.homedir(), '.walkie')
const IPC_PATH = IS_WINDOWS
  ? '\\\\.\\pipe\\walkie-daemon'
  : path.join(WALKIE_DIR, 'daemon.sock')
const PID_FILE = path.join(WALKIE_DIR, 'daemon.pid')
const LOG_FILE = path.join(WALKIE_DIR, 'daemon.log')

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.join(' ')}\n`
  try { fs.appendFileSync(LOG_FILE, line) } catch {}
}

const TTL_MS = (parseInt(process.env.WALKIE_TTL, 10) || 86400) * 1000
const COMPACT_INTERVAL = 15 * 60 * 1000

class WalkieDaemon {
  constructor() {
    this.id = agentId()
    this.swarm = new Hyperswarm()
    this.channels = new Map()  // name -> { topicHex, discovery, persist, knownMsgIds, peers: Set, subscribers: Map<clientId, { messages: [], waiters: [], lastReadTs }> }
    this.peers = new Map()     // remoteKey hex -> { conn, channels: Set }
    this.msgSeq = 0
    this._compactTimer = null
  }

  async start() {
    fs.mkdirSync(WALKIE_DIR, { recursive: true })
    fs.writeFileSync(PID_FILE, process.pid.toString())

    // Clean stale socket
    try { fs.unlinkSync(IPC_PATH) } catch {}

    // IPC server for CLI commands
    const server = net.createServer(sock => this._onIPC(sock))
    await new Promise(resolve => server.listen(IPC_PATH, resolve))
    log(`Daemon listening on ${IPC_PATH}`)

    // P2P connections
    this.swarm.on('connection', (conn, info) => this._onPeer(conn, info))

    // TTL compaction on startup + periodic
    store.compactAll(TTL_MS)
    this._compactTimer = setInterval(() => store.compactAll(TTL_MS), COMPACT_INTERVAL)

    process.on('SIGTERM', () => this.shutdown())
    process.on('SIGINT', () => this.shutdown())

    log(`Daemon started id=${this.id} pid=${process.pid}`)
  }

  // ── IPC (CLI <-> Daemon) ──────────────────────────────────────────

  _onIPC(socket) {
    let buf = ''
    socket.on('data', data => {
      buf += data.toString()
      let idx
      while ((idx = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, idx)
        buf = buf.slice(idx + 1)
        if (line.trim()) {
          try {
            this._exec(JSON.parse(line), socket)
          } catch (e) {
            socket.write(JSON.stringify({ ok: false, error: e.message }) + '\n')
          }
        }
      }
    })
    socket.on('error', () => {})
  }

  async _exec(cmd, socket) {
    const reply = d => socket.write(JSON.stringify(d) + '\n')

    try {
      switch (cmd.action) {
        case 'join': {
          const id = cmd.clientId || 'default'
          await this._joinChannel(cmd.channel, cmd.secret, cmd.persist)
          const ch = this.channels.get(cmd.channel)
          const isNew = !ch.subscribers.has(id)
          if (isNew) {
            ch.subscribers.set(id, { messages: [], waiters: [], lastReadTs: 0 })
            // Announce join to existing subscribers
            if (ch.subscribers.size > 1) {
              const announcement = { from: 'system', data: `${id} joined`, ts: Date.now() }
              this._deliverLocal(ch, announcement, id)
            }
          }
          reply({ ok: true, channel: cmd.channel })
          break
        }
        case 'send': {
          const id = cmd.clientId || 'default'
          const count = this._send(cmd.channel, cmd.message, id)
          reply({ ok: true, delivered: count })
          break
        }
        case 'read': {
          const id = cmd.clientId || 'default'
          const ch = this.channels.get(cmd.channel)
          if (!ch) { reply({ ok: false, error: `Not in channel: ${cmd.channel}` }); return }

          // Auto-register subscriber on read if not yet joined
          if (!ch.subscribers.has(id)) {
            ch.subscribers.set(id, { messages: [], waiters: [], lastReadTs: 0 })
          }
          const sub = ch.subscribers.get(id)

          // Merge persisted messages for persistent channels
          if (ch.persist) {
            const stored = store.read(cmd.channel, sub.lastReadTs)
            if (stored.length > 0) {
              // Merge with in-memory, dedup by id
              const inMemIds = new Set(sub.messages.map(m => m.id).filter(Boolean))
              for (const msg of stored) {
                if (!msg.id || !inMemIds.has(msg.id)) sub.messages.push(msg)
              }
              sub.messages.sort((a, b) => a.ts - b.ts)
            }
          }

          // If messages available or no wait requested, return immediately
          if (sub.messages.length > 0 || !cmd.wait) {
            const msgs = sub.messages.splice(0)
            if (msgs.length > 0) {
              sub.lastReadTs = msgs[msgs.length - 1].ts
            }
            reply({ ok: true, messages: msgs })
            return
          }

          // Wait mode: hold connection until a message arrives
          let timer
          if (cmd.timeout) {
            timer = setTimeout(() => {
              sub.waiters = sub.waiters.filter(w => w !== waiter)
              reply({ ok: true, messages: [] })
            }, cmd.timeout * 1000)
          }

          const waiter = (msgs) => {
            if (timer) clearTimeout(timer)
            if (socket.writable) {
              if (msgs.length > 0) sub.lastReadTs = msgs[msgs.length - 1].ts
              reply({ ok: true, messages: msgs })
            } else {
              // Socket gone (client interrupted) — put messages back
              sub.messages.unshift(...msgs)
            }
          }
          sub.waiters.push(waiter)

          // Clean up waiter if socket closes before message arrives
          socket.once('close', () => {
            if (timer) clearTimeout(timer)
            sub.waiters = sub.waiters.filter(w => w !== waiter)
          })
          break
        }
        case 'leave': {
          const id = cmd.clientId || 'default'
          const ch = this.channels.get(cmd.channel)
          if (ch) {
            ch.subscribers.delete(id)
            // Announce leave to remaining subscribers
            if (ch.subscribers.size > 0) {
              const announcement = { from: 'system', data: `${id} left`, ts: Date.now() }
              this._deliverLocal(ch, announcement, null)
            }
            // Only fully leave the channel if no subscribers remain
            if (ch.subscribers.size === 0) {
              await this._leaveChannel(cmd.channel)
            }
          }
          reply({ ok: true })
          break
        }
        case 'status': {
          const channels = {}
          for (const [name, ch] of this.channels) {
            let buffered = 0
            for (const [, sub] of ch.subscribers) buffered += sub.messages.length
            const info = { peers: ch.peers.size, subscribers: ch.subscribers.size, buffered }
            if (ch.persist) {
              info.persist = true
              info.stored = store.read(name, 0).length
            }
            channels[name] = info
          }
          reply({ ok: true, channels, daemonId: this.id })
          break
        }
        case 'ping': {
          reply({ ok: true })
          break
        }
        case 'stop': {
          reply({ ok: true })
          await this.shutdown()
          break
        }
        default:
          reply({ ok: false, error: `Unknown action: ${cmd.action}` })
      }
    } catch (e) {
      reply({ ok: false, error: e.message })
    }
  }

  // ── Channel management ────────────────────────────────────────────

  async _joinChannel(name, secret, persist) {
    if (this.channels.has(name)) {
      // Upgrade to persistent if requested (never downgrade)
      if (persist) {
        const ch = this.channels.get(name)
        if (!ch.persist) {
          ch.persist = true
          ch.knownMsgIds = store.loadIds(name)
          log(`Channel "${name}" upgraded to persistent`)
        }
      }
      return
    }

    const topic = deriveTopic(name, secret)
    const topicHex = topic.toString('hex')
    log(`Joining channel "${name}" topic=${topicHex.slice(0, 16)}...${persist ? ' [persist]' : ''}`)
    const discovery = this.swarm.join(topic, { server: true, client: true })
    await discovery.flushed()
    log(`Channel "${name}" flushed, discoverable`)

    this.channels.set(name, {
      topicHex,
      secret,
      discovery,
      persist: !!persist,
      knownMsgIds: persist ? store.loadIds(name) : null,
      peers: new Set(),
      subscribers: new Map()
    })

    // Re-announce topics to already-connected peers (fixes race condition
    // where peer connects before channel is registered)
    this._reannounce()
  }

  _reannounce() {
    const topics = Array.from(this.channels.values()).map(ch => ch.topicHex)
    const hello = JSON.stringify({ t: 'hello', topics, id: this.id }) + '\n'
    for (const [remoteKey, peer] of this.peers) {
      if (peer.conn?.writable) {
        log(`Re-announcing ${topics.length} topic(s) to ${remoteKey.slice(0, 12)}`)
        peer.conn.write(hello)
      }
      // Also match this peer against our newly added channels
      // (handles case where we received their hello before our channel was ready)
      if (peer.knownTopics) {
        for (const [name, ch] of this.channels) {
          if (peer.knownTopics.has(ch.topicHex) && !ch.peers.has(remoteKey)) {
            ch.peers.add(remoteKey)
            peer.channels.add(name)
            log(`Late-matched channel "${name}" with peer ${remoteKey.slice(0, 12)}`)
            if (ch.persist) {
              this._sendSyncReq(peer.conn, name, ch)
            }
          }
        }
      }
    }
  }

  async _leaveChannel(name) {
    const ch = this.channels.get(name)
    if (!ch) return
    await ch.discovery.destroy()
    this.channels.delete(name)
  }

  // ── P2P peer handling ─────────────────────────────────────────────

  _onPeer(conn, info) {
    const remoteKey = conn.remotePublicKey.toString('hex')
    log(`Peer connected: ${remoteKey.slice(0, 12)}...`)

    const peer = { conn, channels: new Set(), buf: '' }
    this.peers.set(remoteKey, peer)

    // Send handshake: our active topic list
    const topics = Array.from(this.channels.values()).map(ch => ch.topicHex)
    log(`Sending hello with ${topics.length} topic(s)`)
    conn.write(JSON.stringify({ t: 'hello', topics, id: this.id }) + '\n')

    conn.on('data', data => {
      peer.buf += data.toString()
      let idx
      while ((idx = peer.buf.indexOf('\n')) !== -1) {
        const line = peer.buf.slice(0, idx)
        peer.buf = peer.buf.slice(idx + 1)
        if (line.trim()) {
          try { this._onPeerMsg(remoteKey, JSON.parse(line)) } catch {}
        }
      }
    })

    conn.on('close', () => {
      for (const [, ch] of this.channels) ch.peers.delete(remoteKey)
      this.peers.delete(remoteKey)
    })

    conn.on('error', () => conn.destroy())
  }

  _onPeerMsg(remoteKey, msg) {
    const peer = this.peers.get(remoteKey)
    if (!peer) return

    if (msg.t === 'hello') {
      const theirTopics = new Set(msg.topics || [])
      peer.knownTopics = theirTopics  // Store for late-matching
      log(`Got hello from ${remoteKey.slice(0, 12)} with ${theirTopics.size} topic(s)`)
      for (const [name, ch] of this.channels) {
        if (theirTopics.has(ch.topicHex) && !ch.peers.has(remoteKey)) {
          ch.peers.add(remoteKey)
          peer.channels.add(name)
          log(`Matched channel "${name}" with peer ${remoteKey.slice(0, 12)}`)
          // Send sync request for persistent channels
          if (ch.persist) {
            this._sendSyncReq(peer.conn, name, ch)
          }
        }
      }
      return
    }

    if (msg.t === 'msg') {
      for (const [name, ch] of this.channels) {
        if (ch.topicHex === msg.topic) {
          const msgId = msg.msgId || `${msg.id}-${msg.ts}`
          const entry = { from: msg.id || remoteKey.slice(0, 8), data: msg.data, ts: msg.ts, id: msgId }
          // Dedup for persistent channels
          if (ch.persist) {
            if (ch.knownMsgIds.has(msgId)) break
            ch.knownMsgIds.add(msgId)
            store.append(name, entry)
          }
          this._deliverLocal(ch, entry, null)
          break
        }
      }
      return
    }

    if (msg.t === 'sync_req') {
      for (const [name, ch] of this.channels) {
        if (ch.topicHex === msg.topic && ch.persist) {
          const cutoff = Date.now() - TTL_MS
          const since = Math.max(msg.since || 0, cutoff)
          const messages = store.read(name, since)
          if (peer.conn?.writable) {
            peer.conn.write(JSON.stringify({
              t: 'sync_resp',
              topic: ch.topicHex,
              messages
            }) + '\n')
            log(`Sent sync_resp to ${remoteKey.slice(0, 12)}: ${messages.length} msg(s)`)
          }
          break
        }
      }
      return
    }

    if (msg.t === 'sync_resp') {
      for (const [name, ch] of this.channels) {
        if (ch.topicHex === msg.topic && ch.persist) {
          let added = 0
          for (const entry of (msg.messages || [])) {
            const msgId = entry.id || `${entry.from}-${entry.ts}`
            if (ch.knownMsgIds.has(msgId)) continue
            ch.knownMsgIds.add(msgId)
            entry.id = msgId
            store.append(name, entry)
            this._deliverLocal(ch, entry, null)
            added++
          }
          log(`Sync from ${remoteKey.slice(0, 12)}: ${added} new msg(s) for "${name}"`)
          break
        }
      }
      return
    }
  }

  _sendSyncReq(conn, channelName, ch) {
    let since = 0
    const msgs = store.read(channelName, 0)
    if (msgs.length > 0) since = msgs[msgs.length - 1].ts
    if (conn?.writable) {
      conn.write(JSON.stringify({ t: 'sync_req', topic: ch.topicHex, since }) + '\n')
    }
  }

  // ── Send ──────────────────────────────────────────────────────────

  _send(channelName, message, senderClientId) {
    const ch = this.channels.get(channelName)
    if (!ch) throw new Error(`Not in channel: ${channelName}`)

    const ts = Date.now()
    const msgId = `${this.id}-${++this.msgSeq}`
    const payload = JSON.stringify({
      t: 'msg',
      topic: ch.topicHex,
      data: message,
      id: this.id,
      msgId,
      ts
    }) + '\n'

    let count = 0
    for (const remoteKey of ch.peers) {
      const peer = this.peers.get(remoteKey)
      if (peer?.conn?.writable) {
        peer.conn.write(payload)
        count++
      }
    }

    // Deliver to local subscribers (excluding sender)
    const entry = { from: senderClientId || this.id, data: message, ts, id: msgId }

    // Persist if channel has persistence enabled
    if (ch.persist) {
      ch.knownMsgIds.add(msgId)
      store.append(channelName, entry)
    }

    const localCount = this._deliverLocal(ch, entry, senderClientId)
    count += localCount

    return count
  }

  _deliverLocal(ch, entry, excludeId) {
    let count = 0
    for (const [id, sub] of ch.subscribers) {
      if (id === excludeId) continue
      if (sub.waiters.length > 0) {
        sub.waiters.shift()([entry])
      } else {
        sub.messages.push(entry)
      }
      count++
    }
    return count
  }

  // ── Shutdown ──────────────────────────────────────────────────────

  async shutdown() {
    if (this._compactTimer) clearInterval(this._compactTimer)
    try { fs.unlinkSync(IPC_PATH) } catch {}
    try { fs.unlinkSync(PID_FILE) } catch {}
    await this.swarm.destroy()
    process.exit(0)
  }
}

const daemon = new WalkieDaemon()
daemon.start().catch(e => {
  console.error('Failed to start daemon:', e.message)
  process.exit(1)
})
