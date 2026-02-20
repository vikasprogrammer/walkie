# Polling Patterns

Strategies for AI agents to send and receive messages effectively.

## Non-Blocking Poll

Check for messages without waiting. Best for periodic checks between task steps.

```bash
walkie read <channel>
```

Returns immediately. If no messages: `No new messages`. Use this when you have other work to do and just want to check for updates.

## Blocking Wait

Block until a message arrives or timeout elapses.

```bash
walkie read <channel> --wait --timeout 30
```

Use this when you're idle and waiting for a specific response from another agent. The timeout prevents hanging indefinitely.

## Pattern: Task Delegation

One agent sends a task, waits for the result.

```bash
# Coordinator
walkie send work-channel "process /data/input.csv"
walkie read work-channel --wait --timeout 120   # Wait up to 2 min for result

# Worker
walkie read work-channel --wait                 # Get assignment
# ... process ...
walkie send work-channel "result: 42 records processed, output at /tmp/out.csv"
```

## Pattern: Heartbeat / Keep-Alive

Periodic status updates so a coordinator knows workers are alive.

```bash
# Worker (every N steps)
walkie send status-channel "worker-1: alive, step 5/10, 50% done"

# Coordinator (poll periodically)
walkie read status-channel
```

## Pattern: Stop Signal

A coordinator can send a stop signal mid-task.

```bash
# Coordinator
walkie send task-channel "STOP"

# Worker (checks between steps)
MESSAGES=$(walkie read task-channel)
if echo "$MESSAGES" | grep -q "STOP"; then
  walkie send task-channel "acknowledged STOP, cleaning up"
  # ... cleanup ...
  exit 0
fi
```

## Pattern: Request-Response

Simulate synchronous request-response over the async channel.

```bash
# Requester
walkie send qa-channel "REQUEST: what is the current price of BTC?"
RESPONSE=$(walkie read qa-channel --wait --timeout 60)

# Responder
walkie read qa-channel --wait
# Got: "REQUEST: what is the current price of BTC?"
# ... look up answer ...
walkie send qa-channel "RESPONSE: BTC = $45,230"
```

## Pattern: Fan-Out / Fan-In

One coordinator, multiple workers.

```bash
# Coordinator: fan out
walkie send dispatch "task:worker-1:analyze batch A"
walkie send dispatch "task:worker-2:analyze batch B"
walkie send dispatch "task:worker-3:analyze batch C"

# Each worker: read and filter
MESSAGES=$(walkie read dispatch)
# Parse for your task based on worker ID prefix

# Coordinator: fan in (collect results)
walkie read dispatch --wait --timeout 120
# Repeat reads until all workers report back
```

## Tips

- **Non-blocking reads are cheap** — call `walkie read` liberally between steps
- **Buffer awareness** — messages accumulate while you're not reading; a single `read` returns all pending messages
- **No message persistence** — messages are fire-and-forget. If `delivered: 0`, the message is permanently lost. There is no buffering for offline peers. On the same machine, local subscribers (other WALKIE_IDs) do receive messages even when no P2P peers are connected
- **One read = drain** — `walkie read` returns all buffered messages and clears them; you won't see them again
- **Timeout padding** — the CLI adds 5 seconds to the `--wait` timeout internally for IPC overhead, so the actual wait duration matches what you specify
