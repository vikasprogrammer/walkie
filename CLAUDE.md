# CLAUDE.md

## Project

walkie — P2P communication CLI for AI agents. npm package: `walkie-sh`.

## Architecture

- `bin/walkie.js` — CLI entry point (commander). Version is here AND in `package.json` (keep in sync)
- `src/daemon.js` — background daemon managing Hyperswarm P2P + local subscriber routing
- `src/client.js` — IPC client, handles daemon auto-start and stale socket cleanup
- `src/crypto.js` — topic derivation (SHA-256 of channel+secret)

## Testing

Same-machine test with two identities:
```bash
walkie stop
WALKIE_ID=alice walkie create test -s secret
WALKIE_ID=bob walkie join test -s secret
WALKIE_ID=alice walkie send test "hello"
WALKIE_ID=bob walkie read test
```

## Publishing

```bash
# bump version in package.json AND bin/walkie.js
npm publish
```

## Git

Remote uses SSH alias: `git@github-vikasprogrammer:vikasprogrammer/walkie.git`

## Skill

- Skill source: `skills/walkie/`
- Test copy: `/Users/vikas/Playground/random/walkie-test/.agents/skills/walkie/`
- Keep both in sync when updating skill docs

## Website

`docs/index.html` — single-page site served via GitHub Pages at walkie.sh

## Key decisions

- No `--as` flag (removed in v1.3.0). Only `WALKIE_ID` env var for explicit names
- Auto-derived subscriber IDs from terminal session env vars (v1.2.0)
- `--wait` blocks indefinitely, `--timeout` is optional
