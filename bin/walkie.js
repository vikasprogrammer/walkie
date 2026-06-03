#!/usr/bin/env node

const { program } = require('commander')
const { request, streamMessages } = require('../src/client')
const { clientId, chatName, parseChannelArg } = require('../src/cli-utils')

program
  .name('walkie')
  .description(`P2P communication for AI agents. No server. No setup. Just talk.

Getting started:
  $ walkie chat mychannel                    Interactive chat (same name = same channel)
  $ walkie agent mychannel                   AI agent that responds via claude/codex/pi
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
  .version('1.5.0')

async function autoJoin(channelArg, cid, persist) {
  const { channel, secret } = parseChannelArg(channelArg)
  if (channelArg.indexOf(':') !== -1) {
    const cmd = { action: 'join', channel, secret, clientId: cid }
    if (persist) cmd.persist = true
    await request(cmd)
  }
  return channel
}

function execForMessage(command, msg, channel) {
  const { execSync } = require('child_process')
  try {
    execSync(command, {
      timeout: 30000,
      stdio: 'inherit',
      env: {
        ...process.env,
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

function detectCli() {
  const { spawnSync } = require('child_process')
  for (const cmd of ['claude', 'codex', 'pi']) {
    const r = spawnSync('which', [cmd], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    if (r.status === 0) return cmd
  }
  return null
}

function runClaude(prompt, sessionId, model, extraArgs) {
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
  if (result.status !== 0) throw new Error(result.stderr || 'claude exited with code ' + result.status)

  const stdout = (result.stdout || '').trim()
  const out = { text: stdout, sessionId: null }
  const lines = stdout.split('\n').filter(l => l.trim())
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

function runPi(prompt, sessionId, model, extraArgs) {
  const { spawnSync } = require('child_process')
  const args = ['-p', prompt, '--mode', 'json']
  // --session-id reuses (or creates) a session, giving the agent memory across turns
  if (sessionId) args.push('--session-id', sessionId)
  if (model) args.push('--model', model)
  if (extraArgs) args.push(...extraArgs)

  const result = spawnSync('pi', args, {
    timeout: 300000,
    maxBuffer: 10 * 1024 * 1024,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  })

  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(result.stderr || 'pi exited with code ' + result.status)

  // pi --mode json emits newline-delimited events. The session id is on the
  // "session" event; the reply is the text content of the final assistant
  // message (accumulated across message_update/message_end events).
  const out = { text: (result.stdout || '').trim(), sessionId: sessionId || null }
  let assistantText = null
  for (const line of (result.stdout || '').split('\n')) {
    if (!line.trim()) continue
    let obj
    try { obj = JSON.parse(line) } catch { continue }
    if (obj.type === 'session' && obj.id) out.sessionId = obj.id
    const msg = obj.message
    if (msg && msg.role === 'assistant' && Array.isArray(msg.content)) {
      const t = msg.content.filter(c => c && c.type === 'text').map(c => c.text).join('')
      if (t) assistantText = t
    }
  }
  if (assistantText !== null) out.text = assistantText
  return out
}

program
  .command('agent <channel>')
  .description('AI agent that listens and responds via claude, codex or pi')
  .option('--secret <secret>', 'Custom secret (default: channel name)')
  .option('--cli <cli>', 'CLI to use: claude, codex or pi (auto-detected if omitted)')
  .option('--prompt <text>', 'System prompt for the agent')
  .option('--model <model>', 'Model to use')
  .option('--name <name>', 'Agent display name')
  .option('--agent-args <args>', 'Extra CLI arguments passed to claude/codex (e.g. "--dangerously-skip-permissions")')
  .action(async (channelArg, opts) => {
    const cli = opts.cli || detectCli()
    if (!cli) {
      console.error('Error: no supported CLI ("claude", "codex" or "pi") found. Install one first.')
      process.exit(1)
    }
    if (cli !== 'claude' && cli !== 'codex' && cli !== 'pi') {
      console.error(`Error: unsupported CLI "${cli}". Use "claude", "codex" or "pi".`)
      process.exit(1)
    }

    const parsed = parseChannelArg(channelArg)
    const channel = parsed.channel
    const agentName = opts.name || chatName() + '-agent'
    const secret = opts.secret || parsed.secret
    const cid = agentName
    const extraArgs = opts.agentArgs ? opts.agentArgs.split(/\s+/) : null
    const askFn = cli === 'claude' ? runClaude : cli === 'codex' ? runCodex : runPi

    try {
      const resp = await request({ action: 'join', channel, secret, clientId: cid })
      if (!resp.ok) {
        console.error(`Error: ${resp.error}`)
        process.exit(1)
      }

      console.log(`\x1b[1m--- walkie agent: #${channel} ---\x1b[0m`)
      console.log(`\x1b[2mAgent "${agentName}" powered by ${cli}. Listening for messages.\x1b[0m`)
      console.log(`\x1b[2mOthers can talk to this agent with: walkie chat ${channel}\x1b[0m`)
      console.log(`\x1b[2mCtrl+C to stop.\x1b[0m`)
      console.log()

      // Daemon broadcasts "X joined" automatically via system message

      // Message queue — process one at a time
      const queue = []
      let processing = false
      let sessionId = null

      // Loop prevention: track consecutive exchanges with same sender
      let lastSender = null
      let consecutiveCount = 0
      const MAX_CONSECUTIVE = 10

      async function processQueue() {
        if (processing || queue.length === 0) return
        processing = true

        const msg = queue.shift()
        const time = new Date(msg.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        console.log(`\x1b[2m${time}\x1b[0m \x1b[1m${msg.from}\x1b[0m: ${msg.data}`)

        try {
          const prompt = opts.prompt
            ? `${opts.prompt}\n\nMessage from ${msg.from}: ${msg.data}`
            : `You are "${agentName}", an AI agent on a walkie P2P channel called "#${channel}". Someone is talking to you. Be helpful and concise.\n\nMessage from ${msg.from}: ${msg.data}`

          const out = askFn(prompt, sessionId, opts.model, extraArgs)
          sessionId = out.sessionId || sessionId

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

        processing = false
        processQueue()
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
      const cmd = { action: 'join', channel, secret, clientId: clientId() }
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
  .action(async (channelArg, opts) => {
    try {
      const { channel, secret } = parseChannelArg(channelArg)
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

      await streamMessages(channel, secret, cid, abort, (msg) => {
        if (opts.exec) {
          execForMessage(opts.exec, msg, channel)
        } else if (opts.pretty) {
          const time = new Date(msg.ts).toLocaleTimeString()
          console.log(`[${time}] ${msg.from}: ${msg.data}`)
        } else {
          console.log(JSON.stringify(msg))
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
  .action(async (channelArg, message) => {
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
      const resp = await request({ action: 'send', channel, message, clientId: cid })
      if (resp.ok) {
        console.log(`Sent (delivered to ${resp.delivered} recipient${resp.delivered !== 1 ? 's' : ''})`)
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
  .command('read <channel>')
  .description('Read pending messages from a channel')
  .option('-w, --wait', 'Block until a message arrives')
  .option('-t, --timeout <seconds>', 'Optional timeout for --wait in seconds')
  .action(async (channelArg, opts) => {
    try {
      const cid = clientId()
      const channel = await autoJoin(channelArg, cid)
      const cmd = { action: 'read', channel, clientId: cid }
      if (opts.wait) {
        cmd.wait = true
        if (opts.timeout) cmd.timeout = parseInt(opts.timeout, 10)
      }
      const timeout = opts.wait
        ? (opts.timeout ? (parseInt(opts.timeout, 10) + 5) * 1000 : 0)  // 0 = no timeout
        : 10000
      const resp = await request(cmd, timeout)
      if (resp.ok) {
        if (resp.messages.length === 0) {
          console.log('No new messages')
        } else {
          for (const msg of resp.messages) {
            const time = new Date(msg.ts).toLocaleTimeString()
            console.log(`[${time}] ${msg.from}: ${msg.data}`)
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
  .command('status')
  .description('Show active channels and peers')
  .action(async () => {
    try {
      const resp = await request({ action: 'status' })
      if (resp.ok) {
        console.log(`Daemon ID: ${resp.daemonId}`)
        const entries = Object.entries(resp.channels)
        if (entries.length === 0) {
          console.log('No active channels')
        } else {
          for (const [name, info] of entries) {
            let line = `  #${name} — ${info.peers} peer(s), ${info.subscribers} subscriber(s), ${info.buffered} buffered`
            if (info.persist) line += ` [persist: ${info.stored} stored]`
            console.log(line)
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
        const { exec } = require('child_process')
        const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
        exec(`${cmd} ${url}`)
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
