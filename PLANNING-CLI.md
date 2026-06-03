# Planning — CLI variant

A pure-Node CLI version of `whatsapp-mcp`, targeting **Claude Code** users who don't need the Electron DMG. Same MCP server, same Baileys, same SQLite store — just no GUI, no Electron, no DMG.

See [PLANNING.md](./PLANNING.md) for the shared design (tools, storage strategy, socket ownership, etc.). This doc only covers what's specific to the CLI variant.

## Audience

Technical users who already have Node ≥ 20 (which everyone running Claude Code does — Claude Code itself ships as an npm package). The friend who doesn't want to touch Terminal uses the DMG variant; the friend (or Claude Code agent) who's comfortable in Terminal uses this.

## Decisions specific to the CLI variant

### State location

- **`~/.whatsapp-mcp/`** by default. Auth, SQLite store, config, and logs live here.
- Override via `WHATSAPP_MCP_HOME` env var if needed.
- **Separate from the DMG variant's `~/Library/Application Support/WhatsAppMCP/`** so both can be installed without fighting over the linked-device slot.

### Setup UX

- **Interactive by default, fully scriptable via flags.**
- Prompts: "QR or pairing code?", phone-number entry (if code), confirm-before-patching-Claude.
- Every prompt can be skipped with a flag, so a Claude Code agent can drive setup end-to-end unattended:
  ```bash
  whatsapp-mcp setup --method code --phone +5511999999999 --yes
  ```

### Pairing in the terminal

- **QR mode**:
  - Renders ASCII QR to stderr via `qrcode-terminal` for interactive use.
  - **Also writes a PNG of the current QR to `~/.whatsapp-mcp/pairing-qr.png`** so agent-driven flows can `Read` the file to display the QR inline to the user. WhatsApp rotates the QR every ~60s; the PNG is overwritten on each rotation.
  - With `--yes`, the ASCII QR is suppressed (noise in agent transcripts); the PNG is the only artifact.
- **Code mode**: prints the 8-character code formatted as `XXXX-XXXX` with instructions on where to enter it on the phone.

### Agent contract for QR

When an agent runs `whatsapp-mcp setup --yes` and falls back to QR mode (no `--phone` provided), it should:

1. Tell the user pairing is starting and the QR will appear shortly.
2. Read `~/.whatsapp-mcp/pairing-qr.png` and display it (Claude Code renders images inline from `Read`).
3. Re-read the file every ~30s while pairing is pending — the QR rotates.
4. Stop reading once `setup` exits successfully.

### Claude Code integration

- Patches **`~/.claude.json`** (Claude Code's user-scope config) with the standard MCP block:
  ```json
  {
    "mcpServers": {
      "whatsapp": {
        "command": "/Users/<you>/.whatsapp-mcp/repo/bin/whatsapp-mcp",
        "args": ["serve"]
      }
    }
  }
  ```
- **Idempotent** — re-running `whatsapp-mcp setup` is a no-op if the block is already current.
- **Confirmation by default** — shows a diff of what will change, prompts `Apply? [Y/n]`. `--yes` skips.

### Distribution

- **Clone + npm install** for v1. No npm publish, no global install.
- One-liner bootstrap:
  ```bash
  bash <(curl -fsSL https://raw.githubusercontent.com/joaohts/whatsapp-mcp/cli/install.sh)
  ```
- `install.sh` clones to `~/.whatsapp-mcp/repo`, runs `npm install + npm run build + setup`.
- Updates: `git -C ~/.whatsapp-mcp/repo pull && npm install && npm run build`. (Notify-only auto-update can be added later; for v1, manual.)

## Subcommands

| Command | What it does |
|---|---|
| `whatsapp-mcp setup` | Pair + register with Claude Code. The default entry point. |
| `whatsapp-mcp pair` | Pair only. Useful for re-pairing without touching Claude Code config. |
| `whatsapp-mcp serve` | Run the MCP server on stdio. This is what Claude Code spawns. |
| `whatsapp-mcp status` | Show paths + pairing state + whether Claude Code is configured. |
| `whatsapp-mcp version` | Print version. |

## Code reuse from main

- `src/mcp/**`, `src/store/**`, `src/baileys/**`, `src/types/**` — used as-is.
- `src/backend/paths.ts` — patched to honor `WHATSAPP_MCP_HOME`. No-op for the DMG variant (which never sets the env var).
- `src/backend/config.ts`, `src/backend/logger.ts` — used as-is.

New code lives entirely under `src/cli/` + `bin/whatsapp-mcp` + `install.sh`. No duplication of the core.

## Out of scope for v1

- Per-project MCP config (`.mcp.json` in a working dir). Only user-scope `~/.claude.json`.
- Auto-update inside the CLI. Manual `git pull` for now.
- Multi-account.
- Windows / Linux. macOS-only for v1 (same as the DMG variant) because pairing UX and path conventions are Mac-centric.

## What's still open

- Should `serve` ever print anything? Currently it logs only to file. If Claude Code is misconfigured, the user sees nothing — a `--debug` flag that prints to stderr might help.
- Should the bootstrap script handle Node installation if missing (via `nvm` or asking the user to install)? Currently fails fast.
