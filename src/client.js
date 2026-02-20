const net = require('net')
const path = require('path')
const { spawn } = require('child_process')
const fs = require('fs')

const WALKIE_DIR = process.env.WALKIE_DIR || path.join(process.env.HOME, '.walkie')
const SOCKET_PATH = path.join(WALKIE_DIR, 'daemon.sock')
const PID_FILE = path.join(WALKIE_DIR, 'daemon.pid')

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

function isProcessRunning(pid) {
  try { process.kill(pid, 0); return true } catch { return false }
}

async function ensureDaemon() {
  // Try connecting to existing daemon
  try {
    const sock = await connect()
    const resp = await sendCommand(sock, { action: 'ping' })
    sock.destroy()
    if (resp.ok) return
  } catch {}

  // Clean stale socket and PID file before spawning
  try { fs.unlinkSync(SOCKET_PATH) } catch {}
  try {
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10)
    if (!isProcessRunning(pid)) fs.unlinkSync(PID_FILE)
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

  throw new Error('Failed to start walkie daemon. Check ~/.walkie/daemon.log for details')
}

async function request(cmd, timeout) {
  await ensureDaemon()
  const sock = await connect()
  const resp = await sendCommand(sock, cmd, timeout)
  sock.destroy()
  return resp
}

module.exports = { request }
