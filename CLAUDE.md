# whatsapp-mcp

Local-only macOS app that exposes read-only WhatsApp to Claude Desktop via MCP. See `PLANNING.md` for the design.

## Two-agent workflow

This project is structured for parallel development by two Claude Code agents:

- **Backend agent** — Baileys + SQLite + MCP server. Brief: `.claude/agents/backend.md`. Worktree: `~/fun/whatsapp-mcp-backend/` (branch `backend`).
- **GUI agent** — Electron renderer + pairing wizard + settings. Brief: `.claude/agents/gui.md`. Worktree: `~/fun/whatsapp-mcp-gui/` (branch `gui`).

Each agent owns its own subtree under `src/`. The contract is in `src/types/` — both read, only carefully coordinated edits when shapes change.

## Conventions

- Commit message style: imperative, capitalized first word, no trailing period.
- Don't push to a remote unless explicitly told (no GitHub remote yet).
- Keep `PLANNING.md` as the source of truth for design decisions. Update it before changing direction.
- The read-only contract is enforced by code structure: no Baileys send/presence/read calls anywhere in the binary.
