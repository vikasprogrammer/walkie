#!/usr/bin/env node

// Integration test: two logical agents sharing one WALKIE_DIR
// but isolated by WALKIE_AGENT_ID can still communicate.

const { spawn } = require('child_process')
const net = require('net')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')

const BASE = `/tmp/walkie-test-shared-home-${process.pid}-${Date.now()}`
const DAEMON_A = path.join(BASE, 'agents', 'agent-a', 'daemon.sock')
const DAEMON_B = path.join(BASE, 'agents', 'agent-b', 'daemon.sock')
const CLI = path.join(__dirname, '..', 'bin', 'walkie.js')
const CHANNEL = `room-${crypto.randomBytes(4).toString('hex')}`
const SECRET = `secret-${crypto.randomBytes(8).toString('hex')}`

function runCli(agentId, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      env: { ...process.env, WALKIE_DIR: BASE, WALKIE_AGENT_ID: agentId },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let out = ''
    let err = ''
    child.stdout.on('data', d => { out += d.toString() })
    child.stderr.on('data', d => { err += d.toString() })
    child.on('close', code => {
      if (code === 0) resolve({ out, err })
      else reject(new Error(`${args.join(' ')} failed (${code}): ${err || out}`))
    })
  })
}

function ipc(sockPath, cmd, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), timeout)
    const sock = net.connect(sockPath)
    let buf = ''
    sock.on('connect', () => sock.write(JSON.stringify(cmd) + '\n'))
    sock.on('data', d => {
      buf += d.toString()
      const idx = buf.indexOf('\n')
      if (idx !== -1) {
        clearTimeout(timer)
        sock.destroy()
        resolve(JSON.parse(buf.slice(0, idx)))
      }
    })
    sock.on('error', e => { clearTimeout(timer); reject(e) })
  })
}

async function waitReady(sockPath, label) {
  const start = Date.now()
  while (Date.now() - start < 15000) {
    try {
      const r = await ipc(sockPath, { action: 'ping' })
      if (r.ok) return
    } catch {}
    await new Promise(r => setTimeout(r, 200))
  }
  throw new Error(`${label} daemon failed to come up`)
}

async function cleanup() {
  for (const id of ['agent-a', 'agent-b']) {
    try { await runCli(id, ['stop']) } catch {}
  }
  try { fs.rmSync(BASE, { recursive: true, force: true }) } catch {}
}

async function run() {
  await cleanup()

  await runCli('agent-a', ['create', CHANNEL, '-s', SECRET])
  await runCli('agent-b', ['join', CHANNEL, '-s', SECRET])

  await waitReady(DAEMON_A, 'A')
  await waitReady(DAEMON_B, 'B')

  let foundPeers = false
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 500))
    const sA = await ipc(DAEMON_A, { action: 'status' })
    const sB = await ipc(DAEMON_B, { action: 'status' })
    const pA = sA.channels?.[CHANNEL]?.peers || 0
    const pB = sB.channels?.[CHANNEL]?.peers || 0
    if (pA > 0 && pB > 0) {
      foundPeers = true
      break
    }
  }

  if (!foundPeers) {
    throw new Error('Peers never discovered under shared WALKIE_DIR + separate WALKIE_AGENT_ID')
  }

  const send = await runCli('agent-b', ['send', CHANNEL, 'hello from B'])
  if (!send.out.includes('delivered to 1 peer')) {
    throw new Error(`Unexpected send output: ${send.out || send.err}`)
  }

  const read = await runCli('agent-a', ['read', CHANNEL, '--wait', '-t', '5'])
  if (!read.out.includes('hello from B')) {
    throw new Error(`Expected message not found: ${read.out || read.err}`)
  }

  console.log('PASS: shared HOME with scoped agent IDs works')
  await cleanup()
}

run().catch(async err => {
  console.error(err.message)
  await cleanup()
  process.exit(1)
})
