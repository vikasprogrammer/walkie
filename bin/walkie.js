#!/usr/bin/env node

const { program } = require('commander')
const { request } = require('../src/client')

program
  .name('walkie')
  .description('P2P communication CLI for AI agents')
  .version('1.1.0')
  .option('--as <name>', 'Client identity for same-machine multi-agent')

function clientId() {
  return program.opts().as || process.env.WALKIE_ID || undefined
}

program
  .command('create <channel>')
  .description('Create a channel and wait for peers')
  .requiredOption('-s, --secret <secret>', 'Shared secret')
  .action(async (channel, opts) => {
    try {
      const resp = await request({ action: 'join', channel, secret: opts.secret, clientId: clientId() })
      if (resp.ok) {
        console.log(`Channel "${channel}" created. Listening for peers...`)
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
  .command('join <channel>')
  .description('Join an existing channel')
  .requiredOption('-s, --secret <secret>', 'Shared secret')
  .action(async (channel, opts) => {
    try {
      const resp = await request({ action: 'join', channel, secret: opts.secret, clientId: clientId() })
      if (resp.ok) {
        console.log(`Joined channel "${channel}"`)
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
  .command('send <channel> <message>')
  .description('Send a message to a channel')
  .action(async (channel, message) => {
    try {
      const resp = await request({ action: 'send', channel, message, clientId: clientId() })
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
  .option('-t, --timeout <seconds>', 'Timeout for --wait in seconds', '30')
  .action(async (channel, opts) => {
    try {
      const cmd = { action: 'read', channel, clientId: clientId() }
      if (opts.wait) {
        cmd.wait = true
        cmd.timeout = parseInt(opts.timeout, 10)
      }
      const timeout = opts.wait ? (parseInt(opts.timeout, 10) + 5) * 1000 : 10000
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
            console.log(`  #${name} — ${info.peers} peer(s), ${info.subscribers} subscriber(s), ${info.buffered} buffered`)
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
