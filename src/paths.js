const os = require('os')
const path = require('path')

function sanitizeSegment(input) {
  const value = String(input || 'default')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'default'

  // Prevent path-segment escape/collapse tokens.
  if (value === '.' || value === '..') return 'default'
  return value
}

function inferAgentScope(env = process.env) {
  const explicit = env.WALKIE_AGENT_ID
  if (explicit) return sanitizeSegment(explicit)

  // Respect explicit WALKIE_DIR as a complete path selection unless scope is explicitly set.
  if (env.WALKIE_DIR) return null

  // Auto-isolate common agent runtimes so multiple agents can share one HOME
  const inferred = env.YPI_INSTANCE_ID || env.PI_INSTANCE_ID
  if (inferred) return sanitizeSegment(inferred)

  return null
}

function walkieRoot(env = process.env) {
  const home = env.HOME || os.homedir()
  const base = env.WALKIE_DIR || path.join(home, '.walkie')
  const scope = inferAgentScope(env)
  if (!scope) return { root: base, scope: 'default' }
  return { root: path.join(base, 'agents', scope), scope }
}

function walkiePaths(env = process.env) {
  const { root, scope } = walkieRoot(env)
  return {
    root,
    scope,
    socket: path.join(root, 'daemon.sock'),
    pid: path.join(root, 'daemon.pid'),
    log: path.join(root, 'daemon.log')
  }
}

module.exports = { walkiePaths, inferAgentScope }
