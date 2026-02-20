const net = require('net')
const path = require('path')
const { spawn } = require('child_process')
const fs = require('fs')

const WALKIE_DIR = process.env.WALKIE_DIR || path.join(process.env.HOME, '.walkie')
const SOCKET_PATH = path.join(WALKIE_DIR, 'daemon.sock')

function connect() {
  return new Promise((resolve, reject) => {
    const sock = net.connect(SOCKET_PATH)
    sock.on('connect', () => resolve(sock))
    sock.on('error', reject)
  })
}

function sendCommand(sock, cmd, timeout = 60000) {
  return new Promise((resolve, reject) => {
    let buf = ''
    let timer
    if (timeout > 0) {
      timer = setTimeout(() => {
        sock.removeListener('data', onData)
        reject(new Error('Command timed out'))
      }, timeout)
    }

    const onData = (data) => {
      buf += data.toString()
      const idx = buf.indexOf('\n')
      if (idx !== -1) {
        if (timer) clearTimeout(timer)
        sock.removeListener('data', onData)
        try {
          resolve(JSON.parse(buf.slice(0, idx)))
        } catch (e) {
          reject(e)
        }
      }
    }
    sock.on('data', onData)
    sock.write(JSON.stringify(cmd) + '\n')
  })
}

async function ensureDaemon() {
  // Try connecting to existing daemon
  try {
    const sock = await connect()
    const resp = await sendCommand(sock, { action: 'ping' })
    sock.destroy()
    if (resp.ok) return
  } catch {}

  // Spawn daemon
  fs.mkdirSync(WALKIE_DIR, { recursive: true })

  const daemonScript = path.join(__dirname, 'daemon.js')
  const child = spawn(process.execPath, [daemonScript], {
    detached: true,
    stdio: 'ignore'
  })
  child.unref()

  // Poll until ready
  for (let i = 0; i < 50; i++) {
    await new Promise(r => setTimeout(r, 200))
    try {
      const sock = await connect()
      const resp = await sendCommand(sock, { action: 'ping' })
      sock.destroy()
      if (resp.ok) return
    } catch {}
  }

  throw new Error('Failed to start walkie daemon')
}

async function request(cmd, timeout) {
  await ensureDaemon()
  const sock = await connect()
  const resp = await sendCommand(sock, cmd, timeout)
  sock.destroy()
  return resp
}

module.exports = { request }
