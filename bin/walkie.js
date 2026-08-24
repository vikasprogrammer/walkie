#!/usr/bin/env node

const { program } = require('commander')
const { request, streamMessages } = require('../src/client')
const { clientId, chatName, parseChannelArg, resolveIdentity, setIdentity,
  isStableIdentity, identityWarning, configPath, makeMessageFilter, EXIT,
  drainAfterWake } = require('../src/cli-utils')

program
  .name('walkie')
  .description(`P2P communication for AI agents. No server. No setup. Just talk.

Getting started:
  $ walkie chat mychannel                    Interactive chat (same name = same channel)
  $ walkie agent mychannel                   AI agent that responds via claude/codex
  $ walkie agent mychannel --cli codex       Use a specific AI CLI

Programmatic (for agents/scripts):
  $ walkie connect ops:secret                Connect to a channel
  $ walkie send ops "task done"              Send a message
  $ walkie read ops --wait                   Wait for a message
  $ walkie watch ops:secret --pretty         Stream messages in real-time

Identity:
  Set WALKIE_ID=yourname to choose your display name.
  Without it, 'chat' and 'agent' default to your hostname.

How it works:
  Channel + secret are hashed into a topic. Peers find each other via
  Hyperswarm DHT. All traffic is P2P encrypted (Noise protocol).
  A background daemon keeps connections alive between commands.

Docs: https://walkie.sh`)
  .version('1.6.3')

async function autoJoin(channelArg, cid, persist) {
  const { channel, secret } = parseChannelArg(channelArg)
  if (channelArg.indexOf(':') !== -1) {
    const cmd = { action: 'join', channel, secret, clientId: cid }
    if (persist) cmd.persist = true
    await request(cmd)
  }
  return channel
}

const { execFileSync } = require('child_process')

function execForMessage(shellCmd, msg, channel) {
  try {
    execFileSync('/bin/sh', ['-c', '$WALKIE_CMD'], {
      timeout: 30000,
      stdio: 'inherit',
      env: {
        ...process.env,
        WALKIE_CMD: shellCmd,
        WALKIE_MSG: msg.data,
        WALKIE_FROM: msg.from,
        WALKIE_TS: String(msg.ts),
        WALKIE_CHANNEL: channel
      }
    })
  } catch (e) {
    console.error(`exec error: ${e.message}`)
  }
}

program
  .command('chat <channel>')
  .description('Interactive chat — same channel name = same channel')
  .option('--secret <secret>', 'Custom secret (default: channel name)')
  .action(async (channelArg, opts) => {
    const readline = require('readline')
    const name = chatName()
    const parsed = parseChannelArg(channelArg)
    const channel = parsed.channel
    const secret = opts.secret || parsed.secret

    try {
      const cid = name
      const resp = await request({ action: 'join', channel, secret, clientId: cid })
      if (!resp.ok) {
        console.error(`Error: ${resp.error}`)
        process.exit(1)
      }

      console.log(`\x1b[1m--- walkie chat: #${channel} ---\x1b[0m`)
      console.log(`\x1b[2mYou are "${name}". Waiting for others to join with: walkie chat ${channel}\x1b[0m`)
      console.log(`\x1b[2mType a message and press Enter. Ctrl+C to quit.\x1b[0m`)
      console.log()

      // Start streaming incoming messages
      const abort = { aborted: false, socket: null }
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: ''
      })

      // Stream incoming messages in background
      streamMessages(channel, secret, cid, abort, (msg) => {
        // Clear current input line, print message, restore prompt
        readline.clearLine(process.stdout, 0)
        readline.cursorTo(process.stdout, 0)
        const time = new Date(msg.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        console.log(`\x1b[2m${time}\x1b[0m \x1b[1m${msg.from}\x1b[0m: ${msg.data}`)
        rl.prompt(true)
      })

      rl.prompt()

      rl.on('line', async (line) => {
        const text = line.trim()
        if (!text) { rl.prompt(); return }

        // Move cursor up to overwrite the typed line, replace with formatted version
        readline.moveCursor(process.stdout, 0, -1)
        readline.clearLine(process.stdout, 0)
        readline.cursorTo(process.stdout, 0)
        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        console.log(`\x1b[2m${time}\x1b[0m \x1b[1m\x1b[36m${name}\x1b[0m: ${text}`)

        try {
          await request({ action: 'send', channel, message: text, clientId: cid })
        } catch (e) {
          console.error(`\x1b[31mFailed to send: ${e.message}\x1b[0m`)
        }
        rl.prompt()
      })

      let exiting = false
      const cleanup = async () => {
        if (exiting) return
        exiting = true
        abort.aborted = true
        if (abort.socket) try { abort.socket.destroy() } catch {}
        rl.close()
        try { await request({ action: 'leave', channel, clientId: cid }) } catch {}
        console.log('\n\x1b[2mLeft #' + channel + '\x1b[0m')
        process.exit(0)
      }

      rl.on('close', cleanup)
      process.on('SIGINT', cleanup)
      process.on('SIGTERM', cleanup)

    } catch (e) {
      console.error(`Error: ${e.message}`)
      process.exit(1)
    }
  })

// Give this machine a stable identity the first time it connects. Without this,
// non-interactive shells (which is how agents run) fall back to a per-session hash
// or "default", so anything routing or filtering on sender name keys on a value
// that changes out from under it.
function ensureIdentity() {
  if (isStableIdentity()) return clientId()
  const name = require('os').hostname().split('.')[0]
  setIdentity(name)
  console.log(`\x1b[2mIdentity set to "${name}" (stored in ${configPath()}).`)
  console.log(`Change it with: walkie whoami --set <name>\x1b[0m`)
  return name
}

// Render one message. Ids are opt-in because they are noise for humans but the
// only way for an agent to correlate a reply with the question it answers.
function formatMessage(msg, opts = {}) {
  // Local time is the wrong default when the two ends are on different machines,
  // so --utc renders an unambiguous ISO-8601 instant.
  const time = opts.utc ? new Date(msg.ts).toISOString() : new Date(msg.ts).toLocaleTimeString()
  let head = `[${time}] ${msg.from}`
  if (opts.ids) head += ` [${msg.id}${msg.replyTo ? ` \u21a9 ${msg.replyTo}` : ''}]`
  return `${head}: ${msg.data}`
}

// Machine-readable record. `data` is a single JSON string, so multi-line bodies need
// no boundary parsing; `self` and `type` remove the id-matching and prefix-matching
// heuristics that consumers otherwise have to write against the human format.
function toJsonRecord(msg, channel, me) {
  const isSys = msg.from === 'system' || msg.from === 'daemon'
  const rec = {
    seq: msg.seq ?? null,
    id: msg.id || null,
    channel,
    type: isSys ? 'system' : 'message',
    from: isSys ? null : msg.from,
    self: !isSys && msg.from === me,
    ts: msg.ts,
    data: msg.data,
  }
  if (msg.replyTo) rec.replyTo = msg.replyTo
  return rec
}

function detectCli() {
  const { spawnSync } = require('child_process')
  for (const cmd of ['claude', 'codex']) {
    const r = spawnSync('which', [cmd], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    if (r.status === 0) return cmd
  }
  return null
}

function runClaude(prompt, sessionId, model, extraArgs) {
  const { spawnSync } = require('child_process')
  return _parseClaude(_runClaudeSync(prompt, sessionId, model, extraArgs))
}

/** Async version of runClaude — does not block the event loop. */
function runClaudeAsync(prompt, sessionId, model, extraArgs) {
  const { spawn } = require('child_process')
  const args = ['-p', prompt, '--output-format', 'json']
  if (sessionId) args.push('--resume', sessionId)
  if (model) args.push('--model', model)
  if (extraArgs) args.push(...extraArgs)

  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    const child = spawn('claude', args, {
      timeout: 300000,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    })

    child.stdout.on('data', d => { stdout += d.toString() })
    child.stderr.on('data', d => { stderr += d.toString() })

    child.on('error', (err) => reject(err))
    child.on('close', (code) => {
      // claude -p often exits non-zero while still producing valid output on stdout,
      // so a non-zero code alone is not a failure. stderr is NOT a fallback for
      // output: treating it as one posts the error text into the channel as if it
      // were the agent's reply.
      const output = stdout.trim()
      if (!output) {
        return reject(new Error(stderr.trim() || `claude exited with code ${code}`))
      }
      resolve(_parseClaude({ stdout: output }))
    })
  })
}

function _runClaudeSync(prompt, sessionId, model, extraArgs) {
  const { spawnSync } = require('child_process')
  const args = ['-p', prompt, '--output-format', 'json']
  if (sessionId) args.push('--resume', sessionId)
  if (model) args.push('--model', model)
  if (extraArgs) args.push(...extraArgs)

  const result = spawnSync('claude', args, {
    timeout: 300000,
    maxBuffer: 10 * 1024 * 1024,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  })

  if (result.error) throw result.error
  // claude -p often exits non-zero while still producing valid output on stdout.
  // Only throw if there's no stdout at all.
  if (result.status !== 0 && !(result.stdout || '').trim()) {
    throw new Error(result.stderr || 'claude exited with code ' + result.status)
  }

  return { stdout: result.stdout || '', stderr: result.stderr || '' }
}

function _parseClaude({ stdout }) {
  const trimmed = stdout.trim()
  const out = { text: trimmed, sessionId: null }
  const lines = trimmed.split('\n').filter(l => l.trim())
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const obj = JSON.parse(lines[i])
      if (obj.session_id) out.sessionId = obj.session_id
      if (obj.result !== undefined) { out.text = obj.result; break }
    } catch {}
  }
  return out
}

function runCodex(prompt, sessionId, model, extraArgs) {
  const { spawnSync } = require('child_process')
  const fs = require('fs')
  const os = require('os')
  const path = require('path')

  const outFile = path.join(os.tmpdir(), `walkie-codex-${Date.now()}.txt`)
  const args = ['exec', '--ephemeral', '-o', outFile]
  if (model) args.push('-c', `model="${model}"`)
  if (extraArgs) args.push(...extraArgs)

  // Resume previous session if we have one
  if (sessionId) {
    args.splice(1, 0, 'resume', '--last')
    // For resume, prompt goes via stdin or arg after resume flags
    // codex exec resume --last doesn't take a prompt arg easily,
    // so we fall back to a new session with context
  }

  args.push(prompt)

  const result = spawnSync('codex', args, {
    timeout: 300000,
    maxBuffer: 10 * 1024 * 1024,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  })

  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(result.stderr || 'codex exited with code ' + result.status)

  // Read response from output file
  let text = ''
  try {
    text = fs.readFileSync(outFile, 'utf8').trim()
    fs.unlinkSync(outFile)
  } catch {
    // Fallback: parse JSONL stdout for agent_message
    const lines = (result.stdout || '').trim().split('\n')
    for (const line of lines) {
      try {
        const obj = JSON.parse(line)
        if (obj.type === 'item.completed' && obj.item && obj.item.type === 'agent_message') {
          text = obj.item.text
        }
      } catch {}
    }
  }

  // Extract thread_id for session continuity
  let threadId = null
  const lines = (result.stdout || '').split('\n')
  for (const line of lines) {
    try {
      const obj = JSON.parse(line)
      if (obj.type === 'thread.started' && obj.thread_id) threadId = obj.thread_id
    } catch {}
  }

  return { text, sessionId: threadId }
}

program
  .command('agent <channel>')
  .description('AI agent that listens and responds via claude or codex')
  .option('--secret <secret>', 'Custom secret (default: channel name)')
  .option('--cli <cli>', 'CLI to use: claude or codex (auto-detected if omitted)')
  .option('--prompt <text>', 'System prompt for the agent')
  .option('--model <model>', 'Model to use')
  .option('--name <name>', 'Agent display name')
  .option('--concurrency <n>', 'Max parallel tasks (default: 1)', '1')
  .option('--agent-args <args>', 'Extra CLI arguments passed to claude/codex (e.g. "--dangerously-skip-permissions")')
  .action(async (channelArg, opts) => {
    const cli = opts.cli || detectCli()
    if (!cli) {
      console.error('Error: neither "claude" nor "codex" CLI found. Install one first.')
      process.exit(1)
    }
    if (cli !== 'claude' && cli !== 'codex') {
      console.error(`Error: unsupported CLI "${cli}". Use "claude" or "codex".`)
      process.exit(1)
    }

    const parsed = parseChannelArg(channelArg)
    const channel = parsed.channel
    const agentName = opts.name || chatName() + '-agent'
    const secret = opts.secret || parsed.secret
    const cid = agentName
    const extraArgs = opts.agentArgs ? opts.agentArgs.split(/\s+/) : null
    const maxConcurrency = Math.max(1, parseInt(opts.concurrency, 10) || 1)
    const useAsync = cli === 'claude' && maxConcurrency > 1
    if (maxConcurrency > 1 && cli !== 'claude') {
      // runCodex is spawnSync and blocks the event loop, so the pool can never
      // exceed one in flight. Say so rather than printing a concurrency banner
      // that does not reflect what happens.
      console.error(`\x1b[33mWarning: --concurrency is only supported for the claude CLI; ${cli} runs one task at a time.\x1b[0m`)
    }
    const askFn = cli === 'claude' ? runClaude : runCodex
    const askFnAsync = cli === 'claude' ? runClaudeAsync : null

    try {
      const resp = await request({ action: 'join', channel, secret, clientId: cid })
      if (!resp.ok) {
        console.error(`Error: ${resp.error}`)
        process.exit(1)
      }

      console.log(`\x1b[1m--- walkie agent: #${channel} ---\x1b[0m`)
      console.log(`\x1b[2mAgent "${agentName}" powered by ${cli}. Listening for messages.${useAsync ? ` (concurrency: ${maxConcurrency})` : ''}\x1b[0m`)
      console.log(`\x1b[2mOthers can talk to this agent with: walkie chat ${channel}\x1b[0m`)
      console.log(`\x1b[2mCtrl+C to stop.\x1b[0m`)
      console.log()

      // Daemon broadcasts "X joined" automatically via system message

      // Message queue — process up to maxConcurrency at a time
      const queue = []
      let activeCount = 0

      // Loop prevention: track consecutive exchanges with same sender
      let lastSender = null
      let consecutiveCount = 0
      const MAX_CONSECUTIVE = 10

      // Per-task session tracking (concurrency > 1 uses independent sessions)
      let sharedSessionId = null

      async function processQueue() {
        while (activeCount < maxConcurrency && queue.length > 0) {
          const msg = queue.shift()
          activeCount++
          processOne(msg).finally(() => {
            activeCount--
            processQueue()
          })
        }
      }

      async function processOne(msg) {
        const time = new Date(msg.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        console.log(`\x1b[2m${time}\x1b[0m \x1b[1m${msg.from}\x1b[0m: ${msg.data}`)

        try {
          const prompt = opts.prompt
            ? `${opts.prompt}\n\nMessage from ${msg.from}: ${msg.data}`
            : `You are "${agentName}", an AI agent on a walkie P2P channel called "#${channel}". Someone is talking to you. Be helpful and concise.\n\nMessage from ${msg.from}: ${msg.data}`

          // Use async for concurrent processing, sync for single (preserves session)
          const sessionId = maxConcurrency > 1 ? null : sharedSessionId
          let out
          if (useAsync && askFnAsync) {
            out = await askFnAsync(prompt, sessionId, opts.model, extraArgs)
          } else {
            out = askFn(prompt, sessionId, opts.model, extraArgs)
          }
          if (maxConcurrency === 1) sharedSessionId = out.sessionId || sharedSessionId

          if (out.text && out.text.trim()) {
            const respTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            const display = out.text.trim()
            console.log(`\x1b[2m${respTime}\x1b[0m \x1b[1m\x1b[36m${agentName}\x1b[0m: ${display.slice(0, 200)}${display.length > 200 ? '...' : ''}`)
            await request({ action: 'send', channel, message: display, clientId: cid })

            // Track consecutive exchanges
            if (msg.from === lastSender) {
              consecutiveCount++
            } else {
              lastSender = msg.from
              consecutiveCount = 1
            }
          }
        } catch (e) {
          console.error(`\x1b[31m${cli} error: ${e.message}\x1b[0m`)
        }
      }

      // Stream incoming messages
      const abort = { aborted: false, socket: null }

      streamMessages(channel, secret, cid, abort, (msg) => {
        // Don't respond to own messages or system messages
        if (msg.from === cid || msg.from === 'system') return
        // @mention filtering: if directed at someone else, ignore
        const mentions = (msg.data.match(/@([\w-]+)/g) || []).map(m => m.slice(1))
        if (mentions.length > 0 && !mentions.includes(agentName)) return
        // Loop prevention: cap consecutive exchanges with the same sender
        if (msg.from === lastSender && consecutiveCount >= MAX_CONSECUTIVE) {
          console.log(`\x1b[2m[paused] ${MAX_CONSECUTIVE} consecutive exchanges with ${msg.from} — waiting for someone else\x1b[0m`)
          return
        }
        queue.push(msg)
        processQueue()
      })

      let exiting = false
      const cleanup = async () => {
        if (exiting) return
        exiting = true
        abort.aborted = true
        if (abort.socket) try { abort.socket.destroy() } catch {}
        try { await request({ action: 'leave', channel, clientId: cid }) } catch {}
        console.log('\n\x1b[2mAgent stopped\x1b[0m')
        process.exit(0)
      }

      process.on('SIGINT', cleanup)
      process.on('SIGTERM', cleanup)

    } catch (e) {
      console.error(`Error: ${e.message}`)
      process.exit(1)
    }
  })

program
  .command('pair <channel>')
  .description('Start two AI agents collaborating on a channel (brain + executor)')
  .option('--secret <secret>', 'Channel secret')
  .option('--task <text>', 'Initial task to kick things off')
  .option('--brain <cli>', 'CLI for brain (default: codex if available, else claude)')
  .option('--exec-cli <cli>', 'CLI for executor (default: claude if available, else codex)')
  .option('--model <model>', 'Model for both agents')
  .option('--agent-args <args>', 'Extra CLI arguments passed to claude/codex (e.g. "--dangerously-skip-permissions")')
  .action(async (channelArg, opts) => {
    const { spawn } = require('child_process')
    const readline = require('readline')
    const parsed = parseChannelArg(channelArg)
    const channel = parsed.channel
    const secret = opts.secret || parsed.secret

    // Detect available CLIs
    const available = []
    const { spawnSync } = require('child_process')
    for (const cmd of ['codex', 'claude']) {
      const r = spawnSync('which', [cmd], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      if (r.status === 0) available.push(cmd)
    }
    if (available.length === 0) {
      console.error('Error: neither "claude" nor "codex" CLI found.')
      process.exit(1)
    }

    // Assign CLIs — prefer codex for brain, claude for executor
    let brainCli = opts.brain
    let execCli = opts.execCli
    if (!brainCli && !execCli) {
      if (available.includes('codex') && available.includes('claude')) {
        brainCli = 'codex'
        execCli = 'claude'
      } else {
        brainCli = available[0]
        execCli = available[0]
      }
    } else {
      brainCli = brainCli || available[0]
      execCli = execCli || available[0]
    }

    const brainName = `${channel}-brain`
    const execName = `${channel}-exec`
    const brainPrompt = `You are the brain/strategist on walkie channel "#${channel}". Observe what @${execName} reports and provide guidance. Address tasks to @${execName}. Be concise and decisive.`
    const execPrompt = `You are the executor on walkie channel "#${channel}". Carry out tasks and report results. When you need a decision, ask @${brainName}. Report progress to @${brainName}. Be concise.`

    console.log(`\x1b[1m--- walkie pair: #${channel} ---\x1b[0m`)
    console.log(`\x1b[2mBrain: "${brainName}" (${brainCli})\x1b[0m`)
    console.log(`\x1b[2mExecutor: "${execName}" (${execCli})\x1b[0m`)
    console.log(`\x1b[2mCtrl+C to stop both.\x1b[0m`)
    console.log()

    // Build args for child processes
    const scriptPath = __filename
    const buildArgs = (name, cli, prompt) => {
      const args = ['agent', channelArg, '--name', name, '--cli', cli, '--prompt', prompt]
      if (opts.model) args.push('--model', opts.model)
      if (opts.agentArgs) args.push('--agent-args', opts.agentArgs)
      return args
    }

    const brainProc = spawn(process.execPath, [scriptPath, ...buildArgs(brainName, brainCli, brainPrompt)], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, WALKIE_ID: brainName }
    })

    const execProc = spawn(process.execPath, [scriptPath, ...buildArgs(execName, execCli, execPrompt)], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, WALKIE_ID: execName }
    })

    // Prefix and display output from both agents
    const pipe = (proc, label, color) => {
      readline.createInterface({ input: proc.stdout }).on('line', l =>
        console.log(`${color}[${label}]\x1b[0m ${l}`))
      readline.createInterface({ input: proc.stderr }).on('line', l =>
        console.error(`${color}[${label}]\x1b[0m \x1b[31m${l}\x1b[0m`))
    }
    pipe(brainProc, 'brain', '\x1b[35m')
    pipe(execProc, 'exec', '\x1b[36m')

    // Send initial task to brain after agents are ready
    if (opts.task) {
      setTimeout(async () => {
        try {
          const cid = 'pair-user'
          await request({ action: 'join', channel, secret, clientId: cid })
          await request({ action: 'send', channel, message: `@${brainName} ${opts.task}`, clientId: cid })
          console.log(`\x1b[2mTask sent → @${brainName}\x1b[0m`)
        } catch (e) {
          console.error(`Failed to send task: ${e.message}`)
        }
      }, 3000)
    }

    // Cleanup
    let exiting = false
    const cleanup = () => {
      if (exiting) return
      exiting = true
      brainProc.kill('SIGTERM')
      execProc.kill('SIGTERM')
      console.log('\n\x1b[2mBoth agents stopped.\x1b[0m')
      setTimeout(() => process.exit(0), 500)
    }

    process.on('SIGINT', cleanup)
    process.on('SIGTERM', cleanup)
    brainProc.on('exit', () => { if (!exiting) cleanup() })
    execProc.on('exit', () => { if (!exiting) cleanup() })
  })

program
  .command('connect <channel>')
  .description('Connect to a channel (format: channel:secret)')
  .option('--persist', 'Enable persistent message storage')
  .action(async (channelArg, opts) => {
    try {
      const { channel, secret } = parseChannelArg(channelArg)
      const cmd = { action: 'join', channel, secret, clientId: ensureIdentity() }
      if (opts.persist) cmd.persist = true
      const resp = await request(cmd)
      if (resp.ok) {
        console.log(`Connected to channel "${channel}"${opts.persist ? ' [persist]' : ''}`)
      } else {
        console.error(`Error: ${resp.error}`)
        process.exit(1)
      }
    } catch (e) {
      console.error(`Error: ${e.message}`)
      process.exit(1)
    }
  })

program
  .command('watch <channel>')
  .description('Stream messages from a channel (format: channel:secret)')
  .option('--pretty', 'Human-readable format instead of JSONL')
  .option('--exec <cmd>', 'Run command for each message (env: WALKIE_MSG, WALKIE_FROM, WALKIE_TS, WALKIE_CHANNEL)')
  .option('--persist', 'Enable persistent message storage')
  .option('--from-others', 'Exclude your own messages')
  .option('--no-system', 'Exclude join/leave system messages')
  .option('--from <name>', 'Only messages from this sender')
  .option('--ids', 'Show message ids and reply-to references with --pretty')
  .option('--utc', 'Render timestamps as UTC ISO-8601 with --pretty')
  .option('--out <file>', 'Append output to a file instead of stdout')
  .option('--detach', 'Run in the background and print the pid (requires --out)')
  .action(async (channelArg, opts) => {
    try {
      const { channel, secret } = parseChannelArg(channelArg)

      // watch holds the foreground, which an agent cannot afford — which is why the
      // docs steer agents to background `read --wait` instead. --detach re-runs this
      // command in the background writing to a file the agent can tail or grep
      // whenever it likes, non-destructively, unlike read.
      if (opts.detach) {
        if (!opts.out) {
          console.error('Error: --detach requires --out <file>')
          process.exit(EXIT.ERROR)
        }
        const child = require('child_process').spawn(
          process.execPath,
          process.argv.slice(1).filter(a => a !== '--detach'),
          { detached: true, stdio: 'ignore' }
        )
        child.unref()
        console.log(`Watching #${channel} in the background (pid ${child.pid}) -> ${opts.out}`)
        process.exit(EXIT.OK)
      }

      const emit = opts.out
        ? (line) => { try { require('fs').appendFileSync(opts.out, line + '\n') } catch (e) { console.error(`write failed: ${e.message}`) } }
        : (line) => console.log(line)

      const cid = clientId()
      const joinCmd = { action: 'join', channel, secret, clientId: cid }
      if (opts.persist) joinCmd.persist = true
      const resp = await request(joinCmd)
      if (!resp.ok) {
        console.error(`Error: ${resp.error}`)
        process.exit(1)
      }

      const abort = { aborted: false, socket: null }

      let exiting = false
      const cleanup = async () => {
        if (exiting) return
        exiting = true
        abort.aborted = true
        if (abort.socket) {
          try { abort.socket.destroy() } catch {}
        }
        try { await request({ action: 'leave', channel, clientId: cid }) } catch {}
        process.exit(0)
      }

      process.on('SIGINT', cleanup)
      process.on('SIGTERM', cleanup)

      const keep = makeMessageFilter(opts, cid || 'default')

      await streamMessages(channel, secret, cid, abort, (msg) => {
        if (!keep(msg)) return
        if (opts.exec) {
          execForMessage(opts.exec, msg, channel)
        } else if (opts.pretty) {
          emit(formatMessage(msg, opts))
        } else {
          emit(JSON.stringify(toJsonRecord(msg, channel, cid || 'default')))
        }
      }, opts.persist)
    } catch (e) {
      console.error(`Error: ${e.message}`)
      process.exit(1)
    }
  })

program
  .command('send <channel> [message]')
  .description('Send a message to a channel (reads from stdin if no message given)')
  .option('--reply-to <id>', 'Mark this message as a reply to a message id')
  .option('--to <id>', 'Deliver only to this subscriber (unicast)')
  .option('--await-reply [seconds]', 'Block until someone replies to this message (default 60s)')
  .option('--warn-if-unread', 'Warn on stderr if you have unread messages when sending')
  .action(async (channelArg, message, opts) => {
    try {
      // Read from stdin if no message argument provided
      if (!message) {
        const chunks = []
        for await (const chunk of process.stdin) chunks.push(chunk)
        message = Buffer.concat(chunks).toString().trimEnd()
        if (!message) {
          console.error('Error: no message provided')
          process.exit(1)
        }
      }
      // Unescape shell artifacts (e.g. \! from zsh/bash history expansion)
      message = message.replace(/\\!/g, '!')

      const cid = clientId()
      const channel = await autoJoin(channelArg, cid)
      const sendCmd = { action: 'send', channel, message, clientId: cid }
      if (opts.replyTo) sendCmd.replyTo = opts.replyTo
      if (opts.to) sendCmd.to = opts.to
      const resp = await request(sendCmd)
      if (resp.ok) {
        // "Delivered" overclaimed: reaching a peer daemon says nothing about whether
        // any agent consumed the message. Report where it was queued instead.
        const peers = resp.peerDaemons
        const subs = resp.localSubscribers
        if (peers === undefined && subs === undefined) {
          console.log(`Queued (${resp.delivered} recipient${resp.delivered !== 1 ? 's' : ''})`)
        } else {
          const parts = []
          if (peers) parts.push(`${peers} peer daemon${peers !== 1 ? 's' : ''}`)
          if (subs) parts.push(`${subs} local subscriber${subs !== 1 ? 's' : ''}`)
          const matched = (resp.recipients && resp.recipients.length) ? resp.recipients : []

          // A directed send that matched nobody locally must not read as success.
          // Saying "no peers or subscribers on this channel" would be wrong too:
          // the channel may be busy, just not with the name that was addressed.
          if (opts.to && matched.length === 0) {
            if (peers) {
              console.log(`Queued at ${peers} peer daemon${peers !== 1 ? 's' : ''}`)
              console.error(`\x1b[33mwarning: no local subscriber named "${opts.to}" — remote delivery to that name is not confirmed\x1b[0m`)
            } else {
              console.log(`Not delivered — no subscriber named "${opts.to}" on this channel`)
              process.exit(EXIT.NOTHING_QUEUED)
            }
          } else if (parts.length) {
            // Name the local recipients: a bare count is not actionable once a
            // channel has more than two members.
            const who = matched.length ? ` (${matched.join(', ')})` : ''
            console.log(`Queued at ${parts.join(', ')}${who}`)
          } else {
            // Nothing anywhere means the message is gone — there is no offline queue.
            console.log('Queued nowhere — no peers or subscribers on this channel')
            process.exit(EXIT.NOTHING_QUEUED)
          }
        }

        // Delivery is fast but not synchronous. If something arrived while this
        // message was being composed, the premise behind it may already be stale.
        if (opts.warnIfUnread && resp.unread > 0) {
          console.error(`\x1b[33mwarning: ${resp.unread} unread message(s) in your buffer — re-read before acting on this\x1b[0m`)
        }

        if (opts.awaitReply) {
          const secs = typeof opts.awaitReply === 'string'
            ? Math.max(1, parseInt(opts.awaitReply, 10) || 60)
            : 60
          // Ask the daemon to watch for the reply. Polling the buffer cannot work:
          // any other reader on this identity — the background `read --wait` the
          // docs recommend — consumes the reply first, and the ack then times out
          // silently while the answer sits in another process's output. The daemon
          // matches at delivery time, before buffers, so no reader can hide it.
          const r = await request(
            { action: 'awaitReply', channel, clientId: cid, replyTo: resp.msgId, timeout: secs },
            (secs + 5) * 1000
          )
          if (r.ok && r.reply) {
            console.log(formatMessage(r.reply, opts))
            return
          }
          console.error(`Error: no reply within ${secs}s`)
          process.exit(EXIT.TIMEOUT)
        }
      } else {
        console.error(`Error: ${resp.error}`)
        process.exit(/^Not in channel/.test(resp.error || '') ? EXIT.NOT_IN_CHANNEL : EXIT.ERROR)
      }
    } catch (e) {
      console.error(`Error: ${e.message}`)
      process.exit(1)
    }
  })

program
  .command('read <channel>')
  .description('Read pending messages from a channel')
  .option('-w, --wait', 'Block until a message arrives')
  .option('-t, --timeout <seconds>', 'Optional timeout for --wait in seconds')
  .option('--from-others', 'Exclude your own messages')
  .option('--no-system', 'Exclude join/leave system messages')
  .option('--from <name>', 'Only messages from this sender')
  .option('--ids', 'Show message ids and reply-to references')
  .option('--drain', 'On wake, keep collecting until the channel goes quiet')
  .option('--settle <ms>', 'How long the channel must be quiet before --drain returns (default 200)')
  .option('--json', 'JSONL output, one record per line')
  .option('--utc', 'Render timestamps as UTC ISO-8601')
  .option('--peek', 'Show buffered messages without consuming them')
  .action(async (channelArg, opts) => {
    try {
      const cid = clientId()
      const me = cid || 'default'
      const channel = await autoJoin(channelArg, cid)
      const keep = makeMessageFilter(opts, me)
      const deadline = opts.wait && opts.timeout
        ? Date.now() + parseInt(opts.timeout, 10) * 1000
        : null

      let printed = false
      let remaining = 0
      while (true) {
        const cmd = { action: 'read', channel, clientId: cid }
        if (opts.peek) cmd.peek = true
        let secondsLeft = null
        if (opts.wait && !opts.peek) {
          cmd.wait = true
          if (deadline) {
            secondsLeft = Math.ceil((deadline - Date.now()) / 1000)
            if (secondsLeft <= 0) break
            cmd.timeout = secondsLeft
          }
        }
        const timeout = (opts.wait && !opts.peek)
          ? (secondsLeft !== null ? (secondsLeft + 5) * 1000 : 0)  // 0 = no timeout
          : 10000
        const resp = await request(cmd, timeout)
        if (!resp.ok) {
          console.error(`Error: ${resp.error}`)
          process.exit(/^Not in channel/.test(resp.error || '') ? EXIT.NOT_IN_CHANNEL : EXIT.ERROR)
        }

        let batch = resp.messages
        remaining = resp.unread || 0
        if (opts.wait && !opts.peek && opts.drain) {
          // A --wait wake carries only the message that woke it. Wait for the channel
          // to go quiet rather than reading once — at the moment of the wake the
          // buffer is empty, so a single follow-up read always comes back with
          // nothing and the rest of the burst is stranded.
          const settleMs = Math.max(0, parseInt(opts.settle, 10) || 200)
          const extra = await drainAfterWake({
            settleMs,
            capMs: Math.max(settleMs * 10, 5000),
            sleep: (ms) => new Promise(r => setTimeout(r, ms)),
            read: async () => {
              const more = await request({ action: 'read', channel, clientId: cid }, 10000)
              if (!more.ok) return []
              remaining = more.unread || 0
              return more.messages
            },
          })
          batch = batch.concat(extra)
        }

        for (const msg of batch.filter(keep)) {
          console.log(opts.json ? JSON.stringify(toJsonRecord(msg, channel, me)) : formatMessage(msg, opts))
          printed = true
        }

        if (printed || !opts.wait || opts.peek) break
        // --wait was woken by traffic the caller filtered out. Keep waiting rather
        // than handing back an empty result and burning their wake-up on noise.
        if (deadline && Date.now() >= deadline) break
      }

      if (!printed) {
        if (!opts.json) console.log('No new messages')
        // Distinguish "waited and nothing came" from "buffer was empty right now".
        if (opts.wait && !opts.peek) process.exit(EXIT.TIMEOUT)
      } else if (remaining > 0) {
        // Never let a read imply it returned everything. An agent that knows it is
        // behind will re-read; one holding a flag it believes drained the buffer
        // will not. Goes to stderr so --json stdout stays pure JSONL.
        console.error(`note: ${remaining} more message(s) still buffered — read again`)
      }
    } catch (e) {
      console.error(`Error: ${e.message}`)
      process.exit(1)
    }
  })

program
  .command('leave <channel>')
  .description('Leave a channel')
  .action(async (channel) => {
    try {
      const resp = await request({ action: 'leave', channel, clientId: clientId() })
      if (resp.ok) {
        console.log(`Left channel "${channel}"`)
      } else {
        console.error(`Error: ${resp.error}`)
        process.exit(1)
      }
    } catch (e) {
      console.error(`Error: ${e.message}`)
      process.exit(1)
    }
  })

program
  .command('log <channel>')
  .description('Read persisted history for a channel (non-destructive)')
  .option('--since <ts>', 'Only messages at or after this epoch-ms or ISO date')
  .option('--limit <n>', 'Show at most the N most recent messages')
  .option('--from <name>', 'Only messages from this sender')
  .option('--no-system', 'Exclude join/leave system messages')
  .option('--from-others', 'Exclude your own messages')
  .option('--ids', 'Show message ids and reply-to references')
  .option('--json', 'JSONL output, one record per line')
  .option('--utc', 'Render timestamps as UTC ISO-8601')
  .action((channelArg, opts) => {
    const store = require('../src/store')
    const { channel } = parseChannelArg(channelArg)

    let since = 0
    if (opts.since) {
      const raw = String(opts.since).trim()
      since = /^\d+$/.test(raw) ? Number(raw) : Date.parse(raw)
      if (!Number.isFinite(since)) {
        console.error('Error: --since must be epoch milliseconds or an ISO-8601 date')
        process.exit(EXIT.ERROR)
      }
    }

    const me = clientId() || 'default'
    let msgs = store.read(channel, since).filter(makeMessageFilter(opts, me))
    if (opts.limit) {
      const n = Math.max(1, parseInt(opts.limit, 10) || 1)
      msgs = msgs.slice(-n)
    }

    if (msgs.length === 0) {
      if (!opts.json) {
        console.log('No stored messages')
        console.log('\x1b[2m(history requires the channel to have been joined with --persist)\x1b[0m')
      }
      return
    }
    for (const msg of msgs) {
      console.log(opts.json ? JSON.stringify(toJsonRecord(msg, channel, me)) : formatMessage(msg, opts))
    }
  })

program
  .command('whoami')
  .description('Show the identity this machine advertises on channels')
  .option('--set <name>', 'Persist a stable identity to ~/.walkie/config.json')
  .action((opts) => {
    if (opts.set) {
      setIdentity(opts.set)
      console.log(`Identity set to "${opts.set}"`)
      console.log(`Stored in ${configPath()}`)
      if (process.env.WALKIE_ID && process.env.WALKIE_ID !== opts.set) {
        console.log(`\x1b[33mNote: WALKIE_ID="${process.env.WALKIE_ID}" is set and overrides this.\x1b[0m`)
      }
      return
    }
    const { id, source } = resolveIdentity()
    const label = {
      env: 'WALKIE_ID environment variable',
      config: configPath(),
      session: 'terminal session (unstable — changes in a new shell)',
      none: 'none — the daemon will attribute messages to "default"'
    }[source]
    console.log(`Identity: ${id || 'default'}`)
    console.log(`Source:   ${label}`)
    const warn = identityWarning()
    if (warn) {
      console.log(``)
      console.log(`\x1b[33m${warn}\x1b[0m`)
      console.log(`\x1b[33mFix with: walkie whoami --set <name>\x1b[0m`)
    }
  })

program
  .command('status')
  .description('Show active channels and peers')
  .action(async () => {
    try {
      const resp = await request({ action: 'status' })
      if (resp.ok) {
        console.log(`Daemon ID: ${resp.daemonId}`)
        // Surface the sending identity here: a silent fallback is easiest to catch
        // at the moment someone is already looking at their setup.
        const { id, source } = resolveIdentity()
        const note = { env: '', config: '', session: ' (unstable — derived from this terminal session)', none: ' (no identity set)' }[source]
        console.log(`Sending as: ${id || 'default'}${note}`)
        const entries = Object.entries(resp.channels)
        if (entries.length === 0) {
          console.log('No active channels')
        } else {
          const me = id || 'default'
          for (const [name, info] of entries) {
            let line = `  #${name} — ${info.peers} peer(s), ${info.subscribers} subscriber(s), ${info.buffered} buffered`
            if (info.persist) line += ` [persist: ${info.stored} stored]`
            console.log(line)
            // Aggregate "buffered" cannot answer "do I have unread?" when several
            // identities share this daemon, so break it down per subscriber.
            const by = info.bufferedBy || {}
            const others = Object.entries(by).filter(([sid]) => sid !== me)
            if (by[me] !== undefined || others.length) {
              const mine = by[me] || 0
              let detail = `      unread for ${me}: ${mine}`
              if (others.length) {
                detail += ` (others: ${others.map(([sid, n]) => `${sid}=${n}`).join(', ')})`
              }
              console.log(detail)
            }
          }
        }
      } else {
        console.error(`Error: ${resp.error}`)
        process.exit(1)
      }
    } catch (e) {
      console.error(`Error: ${e.message}`)
      process.exit(1)
    }
  })

program
  .command('slack <channel>')
  .description('Bridge a walkie channel to a Slack channel')
  .option('--token <token>', 'Slack bot token (or SLACK_BOT_TOKEN env var)')
  .option('--app-token <token>', 'Slack app-level token (or SLACK_APP_TOKEN env var)')
  .option('--slack-channel <id>', 'Slack channel ID or name')
  .option('--secret <secret>', 'Custom secret (default: channel name)')
  .action(async (channelArg, opts) => {
    const { startSlackBridge } = require('../src/slack')
    const parsed = parseChannelArg(channelArg)

    const botToken = opts.token || process.env.SLACK_BOT_TOKEN
    const appToken = opts.appToken || process.env.SLACK_APP_TOKEN

    if (!botToken) {
      console.error('Error: Slack bot token required.')
      console.error('  Use --token or set SLACK_BOT_TOKEN env var')
      console.error('')
      console.error('Setup: https://api.slack.com/apps → Create New App')
      console.error('  Bot Token Scopes: chat:write, channels:history, channels:read, users:read')
      console.error('  Enable Socket Mode, subscribe to message.channels event')
      process.exit(1)
    }
    if (!appToken) {
      console.error('Error: Slack app-level token required.')
      console.error('  Use --app-token or set SLACK_APP_TOKEN env var')
      console.error('')
      console.error('Setup: https://api.slack.com/apps → Basic Information → App-Level Tokens')
      console.error('  Create token with connections:write scope')
      process.exit(1)
    }
    if (!opts.slackChannel) {
      console.error('Error: --slack-channel required (channel ID or name)')
      process.exit(1)
    }

    try {
      const bridge = await startSlackBridge({
        botToken,
        appToken,
        channel: parsed.channel,
        secret: opts.secret || parsed.secret,
        slackChannel: opts.slackChannel
      })

      console.log(`\x1b[1m--- walkie slack bridge ---\x1b[0m`)
      console.log(`\x1b[2mwalkie #${parsed.channel} \u2194 Slack ${bridge.slackChannelName}\x1b[0m`)
      console.log(`\x1b[2mBridge ID: ${bridge.bridgeId}\x1b[0m`)
      console.log(`\x1b[2mCtrl+C to stop.\x1b[0m`)
      console.log()

      let exiting = false
      const cleanup = async () => {
        if (exiting) return
        exiting = true
        await bridge.close()
        console.log('\n\x1b[2mSlack bridge stopped.\x1b[0m')
        process.exit(0)
      }
      process.on('SIGINT', cleanup)
      process.on('SIGTERM', cleanup)
    } catch (e) {
      console.error(`Error: ${e.message}`)
      process.exit(1)
    }
  })

program
  .command('web')
  .description('Start web-based chat UI')
  .option('-p, --port <port>', 'HTTP port', '3000')
  .option('-c, --channel <channels...>', 'Auto-join channels (format: channel:secret)')
  .option('--no-open', 'Do not open browser automatically')
  .action(async (opts) => {
    try {
      const { startWebServer } = require('../src/web')
      const { port } = await startWebServer({ port: parseInt(opts.port, 10) })
      let url = `http://localhost:${port}`
      if (opts.channel && opts.channel.length > 0) {
        url += '?' + opts.channel.map(c => 'c=' + encodeURIComponent(c)).join('&')
      }
      console.log(`walkie web UI → ${url}`)
      if (opts.open) {
        const openBin = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
        execFileSync(openBin, [url], { stdio: 'ignore' })
      }
    } catch (e) {
      console.error(`Error: ${e.message}`)
      process.exit(1)
    }
  })

program
  .command('stop')
  .description('Stop the walkie daemon')
  .action(async () => {
    try {
      await request({ action: 'stop' })
      console.log('Daemon stopped')
    } catch {
      console.log('Daemon is not running')
    }
  })

program.parse()
