# whatsapp-mcp

> Status: **pre-alpha**. Two variants shipping in parallel — see [PLANNING.md](./PLANNING.md) (DMG) and [PLANNING-CLI.md](./PLANNING-CLI.md) (CLI).

A macOS app that exposes a **read-only view of your WhatsApp** to local Claude via the [Model Context Protocol](https://modelcontextprotocol.io/). Works with both **Claude Desktop** and **Claude Code**.

Two install paths:

- **DMG (lay-friendly)** — download the DMG, drag to Applications, pair with WhatsApp, click "Configure Claude" → done. Targets Claude Desktop.
- **CLI (Claude Code, Terminal-friendly)** — one-line install, pairs in the terminal, registers with Claude Code automatically:
  ```bash
  bash <(curl -fsSL https://raw.githubusercontent.com/joaohts/whatsapp-mcp/main/install.sh)
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
| `whatsapp-mcp daemon` | Long-running Baileys connection + IPC server. Keeps the local store warm between Claude sessions. See "Daemon mode" below. |
| `whatsapp-mcp serve` | Run the MCP server on stdio. This is what Claude Code spawns. Auto-detects a running daemon and delegates the two stateful tools to it. |
| `whatsapp-mcp status` | Show paths + pairing state + Claude Code config + daemon state. |

## Daemon mode (recommended on always-on machines)

By default the MCP subprocess (spawned by Claude Code) brings up its own Baileys connection — fine if Claude is open most of the day, but on machines where Claude opens briefly and then closes (e.g. a Pi, or a CLI you run a few times a day) the store can lag.

`whatsapp-mcp daemon` is a long-running Node process that:
- Holds the single Baileys linked-device slot continuously.
- Persists incoming `messages.upsert` / `chats.upsert` / etc. events to SQLite in real time, so the store is always fresh.
- Listens on a Unix socket at `~/.whatsapp-mcp/daemon.sock` for the two stateful operations: `fetch_history` and `download_media`.

When `serve` starts, it pings that socket. If the daemon is alive:
- `serve` does **not** open its own Baileys connection (avoiding the 1-linked-device-per-account conflict).
- 10 of the 12 MCP tools read SQLite directly (already real-time).
- `fetch_more_history` and `download_media` are delegated to the daemon over IPC.

If no daemon is running, `serve` behaves exactly as before — opens its own Baileys connection per session.

### Install as a systemd `--user` service (Linux)

After `npm install + npm run build`:

```bash
mkdir -p ~/.config/systemd/user
cp ~/.whatsapp-mcp/repo/install/whatsapp-mcp.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now whatsapp-mcp.service

# So the service runs even when no SSH/console session is active:
sudo loginctl enable-linger "$USER"
```

Check it's up:

```bash
systemctl --user status whatsapp-mcp.service
journalctl --user -u whatsapp-mcp.service -f
~/.whatsapp-mcp/repo/bin/whatsapp-mcp status   # should report daemon: running
```

### Run as a foreground/background process (macOS or quick test)

```bash
nohup ~/.whatsapp-mcp/repo/bin/whatsapp-mcp daemon > /tmp/whatsapp-mcp-daemon.log 2>&1 &
~/.whatsapp-mcp/repo/bin/whatsapp-mcp status   # daemon: running
```

A native macOS `launchd` plist would be the equivalent of the systemd unit — not shipped yet; PRs welcome.

## Showing the QR — three modes

WhatsApp pairing-by-QR rotates a new code every ~60s. The CLI supports four ways for the user to see it; choose based on context.

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

- **Best UX for QR rotation in CLI Claude Code**: re-renders every time WhatsApp pushes a new code, exits cleanly when pairing completes.
- **Best when an agent is driving `setup`** in a transcript that won't render images: the user sees the QR in a dedicated window.

### 4. Inline image via `Read` (Claude Code desktop)

In the **Claude Code desktop app**, the agent can `Read ~/.whatsapp-mcp/pairing-qr.png` and the image renders directly in the chat transcript. Verified to work — `Read` of a PNG outputs an inline image.

- **Cleanest UX for Claude Code desktop specifically**: no separate window, no terminal switching, the QR appears right where the agent's response lives.
- **The file is overwritten on each rotation** (~60s), so the agent should re-`Read` every ~30s while pairing is pending.
- **Does NOT work in CLI Claude Code** (terminal-only client doesn't render image output) — fall back to modes 1 or 3 there.

### Agent guidance

Pick the mode based on the agent's client:

- **Claude Code desktop** → mode 4 (`Read` the PNG inline). Pair with mode 1 as a fallback — the auto-`open` runs anyway and gives the user a Preview window too.
- **Claude Code CLI** (terminal) → mode 1 (auto-Preview, already runs) + suggest mode 3 (`watch-qr` in another tab) for users who prefer ASCII in a terminal that handles QR rendering well.
- **Unknown / other client** → trust mode 1. Tell the user: *"Preview will pop up with the QR — scan it from your phone."*

Concrete flow for a Claude Code desktop agent running `setup --yes` with no `--phone`:

1. Run `setup --yes`. The CLI auto-opens Preview (mode 1) as a safety net.
2. `Read ~/.whatsapp-mcp/pairing-qr.png` to show the QR inline in chat.
3. Wait ~30s; if pairing hasn't completed, `Read` the file again — the PNG has been overwritten with the rotated QR.
4. Repeat until `setup` returns success.

## Status

Pre-alpha. The design — stack, install flow, MCP tool surface, drawbacks — lives in [PLANNING.md](./PLANNING.md) (shared) and [PLANNING-CLI.md](./PLANNING-CLI.md) (CLI variant only).

## License

MIT — see [LICENSE](./LICENSE).
