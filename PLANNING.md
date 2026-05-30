# Planning

A lay-friendly macOS app that exposes **read-only WhatsApp** to local Claude Desktop via MCP. Designed to be shareable with non-technical users: download DMG → drag to Applications → pair → Claude can read their chats. All data stays on the user's Mac.

## Goals

- **Zero-prereq install** — no Homebrew, no Node, no Terminal, no Docker.
- **Fully local, no tracking.** All WhatsApp data + auth state stays on the user's Mac. No telemetry, no crash reporting, no analytics, no third-party servers. The only outbound traffic is to WhatsApp itself (unavoidable, protocol) and to GitHub (only for the update-check poll).
- **Works with any local MCP-capable Claude client** — Claude Desktop and Claude Code. Both speak stdio MCP and accept the same `mcpServers.<name>.{command, args}` config shape; they just store it at different paths.
- **Read-only**: zero side-effects on the user's WhatsApp account (no send, no read receipts, no presence changes, no typing indicators).

### Out of scope

- **WhatsApp Status / Stories / Broadcasts / Channels** — ignored at the Baileys level (same as the FastAPI ancestor). They won't appear in any tool output.
- **Multi-account** — one WhatsApp number per app instance. No account-switcher.
- **Profile pictures** — no `download_profile_picture` tool in v1.

## Decisions

### Stack

- **WhatsApp library: [Baileys](https://github.com/WhiskeySockets/Baileys)** (TypeScript, speaks WhatsApp Web's socket protocol directly). No Chromium, no Docker, no WAHA.
- **Distribution: Electron `.app` bundle inside a DMG.** Bundles Node + dependencies + GUI in a single drag-to-Applications artifact. Tauri was considered but rejected because a Node sidecar would be needed anyway for Baileys/MCP — Electron simplifies that.
- **Transport: local stdio MCP** (no HTTP, no port, no tunnel). Claude Desktop spawns the `.app` binary as a subprocess and talks JSON-RPC over stdin/stdout.
- **Dual-mode binary**: the same `.app` runs in two modes — no args → GUI; `--mcp` flag → MCP server over stdio.

### Install & runtime

- **No code signing for v1.** First launch shows the Gatekeeper warning; the user right-clicks → Open once, and macOS remembers the approval forever after. Signed + notarized ($99/yr Apple Developer) deferred until friction is real.
- **Auth state lives outside the bundle**: `~/Library/Application Support/WhatsAppMCP/auth/` so it survives reinstalls / app updates.
- **Logs**: `~/Library/Logs/WhatsAppMCP/` so debugging the headless `--mcp` mode is possible.
- **Claude client config patching**: the GUI has a "Configure Claude" button that detects which clients are installed and idempotently writes the `mcpServers.whatsapp` block to each one's config. The user never edits JSON.
  - Claude Desktop → `~/Library/Application Support/Claude/claude_desktop_config.json` (detected by `/Applications/Claude.app` existing).
  - Claude Code → `~/.claude.json` (detected by the file existing or by `claude` being on `PATH`).
  - If only one is installed, patch that one and label the button accordingly. If both, patch both. If neither, surface a "Install Claude Desktop or Claude Code first" message.
- **Updates: notify-only.** On launch, the GUI polls the GitHub Releases API for the latest tag and compares to the running version. If newer, shows a non-intrusive banner with a link to the release page (and a "remind me later" option). The user downloads the new DMG and drag-replaces; auth state and store survive. No silent auto-install — keeps complexity out of v1 and respects the unsigned status. Sparkle is the v2 upgrade path if drag-replacing becomes painful.

### Build & distribution

- **arm64-only binary.** Halves DMG size and build time. Intel Mac users (rare by 2026) can request a build manually if needed.
- **Public GitHub repo**: `github.com/joaohts/whatsapp-mcp` (not pushed yet — pending explicit go-ahead).

### Socket ownership

Baileys keeps **one WebSocket per linked device**. WhatsApp boots the older session if two processes claim the same device, so exactly one of GUI / MCP-subprocess owns the live socket at any moment.

- **MCP subprocess is the default owner** when Claude Desktop is open. No background daemon, no autorun-at-login.
- **GUI grabs the socket exclusively** only when needed: during pairing, or when the user clicks "Sync now" / opens the status page.
- **If MCP starts while GUI has the socket, GUI yields immediately.**
- **Initial sync blocks tool responses.** When the MCP subprocess starts, it waits for the Baileys initial history sync to complete before responding to `tools/call`. The first call after Claude Desktop launch is ~3–5s slower; everything after that is real-time fresh because Baileys pushes new messages live for the rest of the session.
- **Trade-off accepted**: the WA session is dormant when Claude Desktop is closed. Unread counts are caught up automatically on next launch, never returned wrong — just delayed by the sync window. Model A (24/7 daemon) is the v2 upgrade if this ever becomes a real complaint.

### Pairing

- **Support both pairing code AND QR code.** Pairing code is the default (no camera needed, friendlier for users already holding their phone). QR code as a secondary tab for users who prefer it or hit edge cases.
- Both flows produced and consumed inside the Electron GUI — never in Terminal.

### GUI scope

The GUI is a **permanent part of the product**, not just an install-time pairing wizard. After setup it stays available for:

- **Status**: connection state, last sync time, current linked-device count, last error.
- **Settings**: toggle which MCP tools are exposed to Claude (per-tool checkboxes). Disabled tools simply don't appear in the server's `tools/list` response — Claude never sees them.
- **Re-pair / unlink** controls.
- **Configure Claude Desktop** button (idempotent — safe to re-run).

**Default tool exposure: all read tools on.** The agent gets full read-only access to any conversation, including downloading audio messages, images, videos, and documents. The per-tool toggles exist for users who want to narrow the scope after the fact — not as a default-deny posture. The safety story comes from the read-only contract (the binary literally cannot write to WhatsApp), not from minimizing what's exposed.

Tool exposure config persisted in `~/Library/Application Support/WhatsAppMCP/config.json`. The `--mcp` subprocess reads this on startup; changing settings while Claude is open requires a Claude restart to take effect (the subprocess re-reads on respawn).

## Architecture sketch

```
WhatsAppMCP.app/
└── Contents/MacOS/WhatsAppMCP        ← Electron binary, two modes:
                                        • no args → GUI (pair, status, settings, configure Claude)
                                        • --mcp   → MCP server over stdio

~/Library/Application Support/WhatsAppMCP/
├── auth/                              ← Baileys multi-file auth state
└── config.json                        ← user prefs (tool toggles, etc.)

~/Library/Logs/WhatsAppMCP/
└── mcp.log                            ← --mcp mode logs

Same block written to whichever Claude client(s) are present:
- Claude Desktop: ~/Library/Application Support/Claude/claude_desktop_config.json
- Claude Code:    ~/.claude.json
{
  "mcpServers": {
    "whatsapp": {
      "command": "/Applications/WhatsAppMCP.app/Contents/MacOS/WhatsAppMCP",
      "args": ["--mcp"]
    }
  }
}
```

## Storage

Baileys is event-driven, not query-response. It receives messages/chats/contacts via events (`messages.upsert`, `chats.upsert`, etc.) and provides no built-in "give me message #1234" API. To answer MCP tool calls reliably — especially across Claude Desktop restarts — we need a **local persistent store**.

- **Backend: SQLite** via `better-sqlite3` (synchronous, fast, embedded; ships native binary in the Electron build).
- **Location**: `~/Library/Application Support/WhatsAppMCP/store.db`.
- **Schema** (initial): `chats`, `messages`, `contacts`, `media_refs`. Plus an FTS5 virtual table over `messages.body` for `search_messages`.
- **Writers**: only the process that currently owns the Baileys socket writes to the store. Default writer is the MCP subprocess; see "Socket ownership" in Decisions.
- **Reads**: all MCP tools query SQLite. `get_chat_messages` returns whatever's in the store — no implicit Baileys round-trip.
- **Sync depth: shallow on first pair, deepen on demand.** Baileys runs with `syncFullHistory: false`, so the initial history sync covers recent activity (roughly the last few weeks for active chats) and lands in SQLite. Anything older isn't fetched until the agent explicitly asks for it via `fetch_more_history(chat_id, …)` — that tool triggers Baileys' history request, awaits the response event, persists the new rows, and reports back. **The new rows stay in the store**, so subsequent sessions inherit the deepened history without re-fetching. The agent decides when to dig (e.g. "user asked about something from last March → fetch backwards in mom's chat").
- **Media files**: decrypted media is **not** persisted to disk by default. `download_media` calls Baileys → decrypted Buffer → returned inline as MCP content. If/when we want to cache (to avoid re-downloading for repeat queries), we'd add a `~/Library/Application Support/WhatsAppMCP/media/` directory and an LRU.

## MCP tool surface (initial)

**Chats & messages**
- `list_chats(limit, offset)`
- `chats_overview(limit, offset)`
- `get_chat_messages(chat_id, limit, before_timestamp?, after_timestamp?, from_me?)` — reads SQLite; per message returns: `body`, `timestamp`, `from`, `from_me`, `type`, `has_media`, `reactions[]`, `reply_to_message_id?`, `edited_at?`, `read_by_recipient?` (for outbound — the "blue check" state)
- `get_message(chat_id, message_id)`
- `unread_summary()` — chats with unread + counts, no message bodies
- `search_messages(query, max_chats, limit_per_chat)` — local FTS5 over message bodies
- `fetch_more_history(chat_id, before_timestamp?, count=50)` — deepen the local store for a chat by pulling older messages from WhatsApp via Baileys; persists to SQLite. Returns `{ fetched_count, oldest_in_store_timestamp }`. The agent calls this when `get_chat_messages` doesn't reach back far enough.

**Media**
- `list_chat_media(chat_id, type?, limit, offset)` — index of media in a chat (id, timestamp, mime, filename, caption) without downloading bodies
- `download_media(chat_id, message_id)` — returns the media inline as MCP content (audio/image/video/document type per the message). Audio (voice notes) returned as audio content so Claude can transcribe natively.

**Contacts & groups**
- `list_contacts(refresh?)`
- `search_contacts(query, limit)`
- `get_contact(chat_id)` — **polymorphic**: for `@c.us` IDs returns direct-contact fields (`name`, `pushname`, `number`, `profile_url`?); for `@g.us` IDs returns group fields (`subject`, `description`, `created_at`, `participants[]`, `admins[]`, `only_admins_can_send`). The response shape varies by ID type; the agent handles both.

The read-only contract is enforced by **not importing** any Baileys send/presence/read functions in the MCP server module. Even if a tool toggle were misconfigured, the code path to mutate WhatsApp state simply doesn't exist in the binary.

**Media size caveat**: MCP content blocks have practical size limits (Claude's per-message context). Large videos may not fit in a single `download_media` response. `list_chat_media` exists partly to let the agent pick the right item before pulling it.

## Communication flow

1. User launches Claude Desktop or Claude Code.
2. That client reads its MCP config, spawns `WhatsAppMCP --mcp` as a child process.
3. MCP server opens the SQLite store, loads Baileys auth state, opens the WhatsApp socket (~2–5s).
4. Baileys delivers any history sync / new messages since last connection → store gets updated via event handlers.
5. Claude calls `tools/list` → server announces the enabled tools.
6. User asks Claude something WhatsApp-related → Claude calls `tools/call` → server queries SQLite (and, for media, calls `downloadMediaMessage`) → JSON / binary response.
7. The client quits → SIGTERM closes the Baileys socket and the SQLite handle.

## Known drawbacks

1. **claude.ai web won't work** — local stdio MCP is Desktop-only. Web Claude needs remote MCP over HTTPS, which would break the "stays local" goal. Documented constraint, not fixing.
2. **Reconnect latency** every Claude Desktop launch (~2–5s before tools work).
3. **WhatsApp session is idle when Claude is closed** → unread counts lag until next launch. A menu-bar daemon keeping the socket warm is an option for later; deferred.
4. **30-day inactivity unlinks** the WhatsApp linked device → forced re-pair if Claude isn't used for a month.
5. **No push** — MCP is request/response only; Claude can't be notified of new messages.
6. **MCP subprocess does not auto-respawn** if it crashes mid-session — user must quit/relaunch Claude.
7. **Memory**: Electron + Node + Baileys ≈ 200–300MB while Claude is open.
8. **Unsigned Gatekeeper friction** on first launch (one-time right-click → Open).
9. **WhatsApp 4-linked-device cap** — user may need to unlink another device first.

## Pairing UX (target)

1. Open `WhatsAppMCP.app`.
2. Choose tab: **Pairing code** (default) or **QR code**.
3. **Pairing code path**: enter phone number → app displays an 8-character code → instructions: open WhatsApp → Settings → Linked Devices → Link a Device → "Link with phone number instead" → enter code.
4. **QR code path**: app displays a QR → user opens WhatsApp → Settings → Linked Devices → Link a Device → scans.
5. Either way: socket completes → GUI shows initial history sync progress (spinner + running count "synced 1,247 messages across 38 chats…") → "✓ Connected as [name]" → auth state saved.
6. "Configure Claude" button → detects installed clients (Desktop, Code, or both) → patches MCP config for each → "Restart Claude, then ask 'what are my unread WhatsApp chats?'"

## Open questions

- **Chat-level blocklist** — v2. Let the user mark specific chats/groups as off-limits so they're filtered out of every tool's response.
- **Menu-bar daemon** to keep the WhatsApp socket warm between Claude sessions — deferred, only worth it if unread-lag becomes a real complaint (i.e. graduate to Model A).
- **Logging UX in the GUI** — surface "last error" prominently so a user can screenshot it instead of digging through `~/Library/Logs/`.
