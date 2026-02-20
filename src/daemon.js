const Hyperswarm = require('hyperswarm')
const net = require('net')
const fs = require('fs')
const path = require('path')
const { deriveTopic, agentId } = require('./crypto')

const WALKIE_DIR = process.env.WALKIE_DIR || path.join(process.env.HOME, '.walkie')
const SOCKET_PATH = path.join(WALKIE_DIR, 'daemon.sock')
const PID_FILE = path.join(WALKIE_DIR, 'daemon.pid')
const LOG_FILE = path.join(WALKIE_DIR, 'daemon.log')

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.join(' ')}\n`
  try { fs.appendFileSync(LOG_FILE, line) } catch {}
}

class WalkieDaemon {
  constructor() {
    this.id = agentId()
    this.swarm = new Hyperswarm()
    this.channels = new Map()  // name -> { topicHex, discovery, peers: Set, subscribers: Map<clientId, { messages: [], waiters: [] }> }
    this.peers = new Map()     // remoteKey hex -> { conn, channels: Set }
  }

  async start() {
    fs.mkdirSync(WALKIE_DIR, { recursive: true })
    fs.writeFileSync(PID_FILE, process.pid.toString())

    // Clean stale socket
    try { fs.unlinkSync(SOCKET_PATH) } catch {}

    // IPC server for CLI commands
    const server = net.createServer(sock => this._onIPC(sock))
    server.listen(SOCKET_PATH)

    // P2P connections
    this.swarm.on('connection', (conn, info) => this._onPeer(conn, info))

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
          await this._joinChannel(cmd.channel, cmd.secret)
          const ch = this.channels.get(cmd.channel)
          if (!ch.subscribers.has(id)) {
            ch.subscribers.set(id, { messages: [], waiters: [] })
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
            ch.subscribers.set(id, { messages: [], waiters: [] })
          }
          const sub = ch.subscribers.get(id)

          // If messages available or no wait requested, return immediately
          if (sub.messages.length > 0 || !cmd.wait) {
            reply({ ok: true, messages: sub.messages.splice(0) })
            return
          }

          // Wait mode: hold connection until a message arrives or timeout
          const timeout = (cmd.timeout || 30) * 1000
          const timer = setTimeout(() => {
            sub.waiters = sub.waiters.filter(w => w !== waiter)
            reply({ ok: true, messages: [] })
          }, timeout)

          const waiter = (msgs) => {
            clearTimeout(timer)
            reply({ ok: true, messages: msgs })
          }
          sub.waiters.push(waiter)
          break
        }
        case 'leave': {
          const id = cmd.clientId || 'default'
          const ch = this.channels.get(cmd.channel)
          if (ch) {
            ch.subscribers.delete(id)
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
            channels[name] = { peers: ch.peers.size, subscribers: ch.subscribers.size, buffered }
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

  async _joinChannel(name, secret) {
    if (this.channels.has(name)) return

    const topic = deriveTopic(name, secret)
    const topicHex = topic.toString('hex')
    log(`Joining channel "${name}" topic=${topicHex.slice(0, 16)}...`)
    const discovery = this.swarm.join(topic, { server: true, client: true })
    await discovery.flushed()
    log(`Channel "${name}" flushed, discoverable`)

    this.channels.set(name, {
      topicHex,
      discovery,
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
        }
      }
      return
    }

    if (msg.t === 'msg') {
      for (const [name, ch] of this.channels) {
        if (ch.topicHex === msg.topic) {
          const entry = { from: msg.id || remoteKey.slice(0, 8), data: msg.data, ts: msg.ts }
          this._deliverLocal(ch, entry, null)
          break
        }
      }
    }
  }

  // ── Send ──────────────────────────────────────────────────────────

  _send(channelName, message, senderClientId) {
    const ch = this.channels.get(channelName)
    if (!ch) throw new Error(`Not in channel: ${channelName}`)

    const ts = Date.now()
    const payload = JSON.stringify({
      t: 'msg',
      topic: ch.topicHex,
      data: message,
      id: this.id,
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
    const entry = { from: senderClientId || this.id, data: message, ts }
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
    try { fs.unlinkSync(SOCKET_PATH) } catch {}
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
