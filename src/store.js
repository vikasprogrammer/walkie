const fs = require('fs')
const path = require('path')
const os = require('os')

const WALKIE_DIR = process.env.WALKIE_DIR || path.join(os.homedir(), '.walkie')
const MSG_DIR = path.join(WALKIE_DIR, 'messages')

function sanitizeName(channel) {
  return channel.replace(/[\x00/\\]/g, '_')
}

function filePath(channel) {
  return path.join(MSG_DIR, sanitizeName(channel) + '.jsonl')
}

function ensureDir() {
  fs.mkdirSync(MSG_DIR, { recursive: true })
}

function append(channel, entry) {
  ensureDir()
  fs.appendFileSync(filePath(channel), JSON.stringify(entry) + '\n')
}

function read(channel, since = 0) {
  const fp = filePath(channel)
  if (!fs.existsSync(fp)) return []
  const lines = fs.readFileSync(fp, 'utf8').split('\n')
  const results = []
  for (const line of lines) {
    if (!line.trim()) continue
    try {
      const entry = JSON.parse(line)
      if (entry.ts > since) results.push(entry)
    } catch {}
  }
  return results
}

function compact(channel, ttlMs) {
  const fp = filePath(channel)
  if (!fs.existsSync(fp)) return
  const cutoff = Date.now() - ttlMs
  const lines = fs.readFileSync(fp, 'utf8').split('\n')
  const kept = []
  for (const line of lines) {
    if (!line.trim()) continue
    try {
      const entry = JSON.parse(line)
      if (entry.ts > cutoff) kept.push(line)
    } catch {}
  }
  if (kept.length === 0) {
    try { fs.unlinkSync(fp) } catch {}
    return
  }
  const tmp = fp + '.tmp'
  fs.writeFileSync(tmp, kept.join('\n') + '\n')
  fs.renameSync(tmp, fp)
}

function compactAll(ttlMs) {
  if (!fs.existsSync(MSG_DIR)) return
  const files = fs.readdirSync(MSG_DIR).filter(f => f.endsWith('.jsonl'))
  for (const f of files) {
    const channel = f.slice(0, -6) // strip .jsonl
    compact(channel, ttlMs)
  }
}

function loadIds(channel) {
  const fp = filePath(channel)
  const ids = new Set()
  if (!fs.existsSync(fp)) return ids
  const lines = fs.readFileSync(fp, 'utf8').split('\n')
  for (const line of lines) {
    if (!line.trim()) continue
    try {
      const entry = JSON.parse(line)
      if (entry.id) ids.add(entry.id)
    } catch {}
  }
  return ids
}

module.exports = { ensureDir, append, read, compact, compactAll, loadIds, sanitizeName }
