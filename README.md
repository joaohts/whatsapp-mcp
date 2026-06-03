# whatsapp-mcp

> Status: **pre-alpha**. Two variants shipping in parallel — see [PLANNING.md](./PLANNING.md) (DMG) and [PLANNING-CLI.md](./PLANNING-CLI.md) (CLI).

A macOS app that exposes a **read-only view of your WhatsApp** to local Claude via the [Model Context Protocol](https://modelcontextprotocol.io/). Works with both **Claude Desktop** and **Claude Code**.

Two install paths:

- **DMG (lay-friendly)** — download the DMG, drag to Applications, pair with WhatsApp, click "Configure Claude" → done. Targets Claude Desktop.
- **CLI (Claude Code, Terminal-friendly)** — one-line install, pairs in the terminal, registers with Claude Code automatically:
  ```bash
  bash <(curl -fsSL https://raw.githubusercontent.com/joaohts/whatsapp-mcp/cli/install.sh)
  ```

**Everything stays on your Mac.** WhatsApp messages, auth state, and configuration never leave the device. The only network endpoint is WhatsApp itself (unavoidable — that's the WA protocol).

## Goals

- **Zero prerequisites** — no Homebrew, no Node, no Terminal, no Docker.
- **Local-only** — no tunnels, no cloud, no third-party servers.
- **Read-only** — never sends messages, never marks anything read, never changes your presence.
- **Configurable** — per-tool toggles in the GUI so you control what Claude can see.

## CLI subcommands

| Command | Purpose |
|---|---|
| `whatsapp-mcp setup` | Pair + register with Claude Code. The default entry point. Interactive prompts unless `--yes` is passed. |
| `whatsapp-mcp pair` | Pair only. Useful for re-pairing without touching Claude Code config. |
| `whatsapp-mcp watch-qr` | Run in a separate terminal alongside `setup` / `pair`. Renders a live-updating ASCII QR; auto-refreshes when WhatsApp rotates (~60s) and exits when pairing completes. |
| `whatsapp-mcp serve` | Run the MCP server on stdio. This is what Claude Code spawns. |
| `whatsapp-mcp status` | Show paths + pairing state + whether Claude Code is configured. |

## Showing the QR — three modes

WhatsApp pairing-by-QR rotates a new code every ~60s. The CLI supports three ways for the user to see it; choose based on context.

### 1. `open` → macOS Preview (default)

`setup` / `pair` automatically run `open <png>` on the first QR event, popping up Preview with the QR.

- **Works everywhere**: any terminal, any chat UI, any Claude Code session.
- **Caveat**: Preview doesn't auto-refresh on file rewrite. If the user doesn't scan within ~60s, the QR in Preview expires and they'll need to re-run `open ~/.whatsapp-mcp/pairing-qr.png`.

Disable with `pair --no-open-qr` (not exposed on `setup` — there it's always on).

### 2. ASCII in the same terminal

`pair` and (interactive) `setup` print the QR as ASCII directly to stderr.

- **Works for**: interactive users running in a real terminal (Terminal.app, iTerm, etc.) where the font/line-height renders block characters cleanly.
- **Suppressed in `--yes` mode** because the ASCII goes into the agent transcript and looks like garbage there.

### 3. Live-updating QR in a separate terminal (`watch-qr`)

Open a second terminal next to the one running `setup` and run:
```bash
whatsapp-mcp watch-qr
```

- **Best UX for QR rotation**: re-renders every time WhatsApp pushes a new code, exits cleanly when pairing completes.
- **Best when an agent is driving `setup`**: the agent doesn't pollute its own transcript with ASCII or images; the user sees the QR in a dedicated window.

### Agent guidance

When a Claude Code agent runs `setup --yes` and the flow falls back to QR (no `--phone`), it should:

1. Tell the user: *"I'll run `whatsapp-mcp setup --yes`. Preview will pop up with the QR. If you'd prefer a live-updating ASCII QR instead, open a new terminal and run `whatsapp-mcp watch-qr` before I start."*
2. Run `setup --yes`. The auto-`open` (mode 1) handles the user-side display by default.
3. The user scans → pairing completes → setup returns.

Agents that *know* their chat UI can render images inline can additionally `Read` `~/.whatsapp-mcp/pairing-qr.png` to embed the QR in the transcript. The file is overwritten on each rotation, so re-reading every ~30s shows the current QR.

## Status

Pre-alpha. The design — stack, install flow, MCP tool surface, drawbacks — lives in [PLANNING.md](./PLANNING.md) (shared) and [PLANNING-CLI.md](./PLANNING-CLI.md) (CLI variant only).

## License

MIT — see [LICENSE](./LICENSE).
