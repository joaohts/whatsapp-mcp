# Planning

A lay-friendly macOS app that exposes **read-only WhatsApp** to local Claude Desktop via MCP. Designed to be shareable with non-technical users: download DMG → drag to Applications → pair → Claude can read their chats. All data stays on the user's Mac.

## Goals

- **Zero-prereq install** — no Homebrew, no Node, no Terminal, no Docker.
- **All WhatsApp data + auth state stays local** on the user's Mac. No tunnels, no cloud, no third-party servers beyond WhatsApp itself.
- **Works with Claude Desktop** (primary target). Claude Code support is a bonus.
- **Read-only**: zero side-effects on the user's WhatsApp account (no send, no read receipts, no presence changes, no typing indicators).

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
- **Claude Desktop config patching**: the GUI has a "Configure Claude Desktop" button that idempotently writes the `mcpServers.whatsapp` block into `~/Library/Application Support/Claude/claude_desktop_config.json`. The user never edits JSON.

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

~/Library/Application Support/Claude/claude_desktop_config.json:
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
- **Writers**: the GUI process (when the app is open) and the `--mcp` subprocess (when Claude Desktop spawns it) both maintain Baileys connections and write to the store. Only one Baileys session can be live per linked device, so we either gate connection-ownership between the two processes or default to "MCP subprocess owns the socket, GUI just reads the store and shows status."
- **Reads**: all MCP tools query SQLite. Even `get_chat_messages` doesn't talk to Baileys directly — it returns whatever's in the store, and optionally triggers a `fetchMessageHistory` (async event) if the user asks for older messages than we have.
- **Media files**: decrypted media is **not** persisted to disk by default. `download_media` calls Baileys → decrypted Buffer → returned inline as MCP content. If/when we want to cache (to avoid re-downloading for repeat queries), we'd add a `~/Library/Application Support/WhatsAppMCP/media/` directory and an LRU.

## MCP tool surface (initial)

**Chats & messages**
- `list_chats(limit, offset)`
- `chats_overview(limit, offset)`
- `get_chat_messages(chat_id, limit, since?, until?, from_me?)` — text + metadata only; `hasMedia` flag indicates downloadable content
- `get_message(chat_id, message_id)`
- `unread_summary()` — chats with unread + counts, no message bodies
- `search_messages(query, max_chats, limit_per_chat)`

**Media**
- `list_chat_media(chat_id, type?, limit, offset)` — index of media in a chat (id, timestamp, mime, filename, caption) without downloading bodies
- `download_media(chat_id, message_id)` — returns the media inline as MCP content (audio/image/video/document type per the message). Audio (voice notes) returned as audio content so Claude can transcribe natively.

**Contacts**
- `list_contacts(refresh?)`
- `search_contacts(query, limit)`
- `get_contact(chat_id)`

The read-only contract is enforced by **not importing** any Baileys send/presence/read functions in the MCP server module. Even if a tool toggle were misconfigured, the code path to mutate WhatsApp state simply doesn't exist in the binary.

**Media size caveat**: MCP content blocks have practical size limits (Claude's per-message context). Large videos may not fit in a single `download_media` response. `list_chat_media` exists partly to let the agent pick the right item before pulling it.

## Communication flow

1. User launches Claude Desktop.
2. Claude Desktop reads `claude_desktop_config.json`, spawns `WhatsAppMCP --mcp` as a child process.
3. MCP server opens the SQLite store, loads Baileys auth state, opens the WhatsApp socket (~2–5s).
4. Baileys delivers any history sync / new messages since last connection → store gets updated via event handlers.
5. Claude calls `tools/list` → server announces the enabled tools.
6. User asks Claude something WhatsApp-related → Claude calls `tools/call` → server queries SQLite (and, for media, calls `downloadMediaMessage`) → JSON / binary response.
7. Claude Desktop quits → SIGTERM closes the Baileys socket and the SQLite handle.

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
5. Either way: socket completes → "✓ Connected as [name]" → auth state saved.
6. "Configure Claude Desktop" button → patches MCP config → "Restart Claude Desktop, then ask 'what are my unread WhatsApp chats?'"

## Open questions

- App name (currently `WhatsAppMCP` as a placeholder).
- **Chat-level blocklist** — let the user mark specific chats/groups as off-limits so they're filtered out of every tool's response. Read-only contract holds either way; this is for privacy in specific conversations (financial, legal, etc.). Probably v2.
- Menu-bar daemon to keep the WhatsApp socket warm between Claude sessions? Deferred — only worth it if unread-lag becomes a real complaint.
- Logging UX in the GUI — surface "last error" prominently so a user can screenshot it instead of digging through `~/Library/Logs/`.
- Auto-update mechanism — Sparkle, GitHub Releases polling, or manual DMG distribution.
