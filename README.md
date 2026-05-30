# whatsapp-mcp

> Status: **planning / pre-alpha**. No working code yet — see [PLANNING.md](./PLANNING.md).

A macOS app that exposes a **read-only view of your WhatsApp** to local Claude via the [Model Context Protocol](https://modelcontextprotocol.io/). Works with both **Claude Desktop** and **Claude Code** — same binary, same MCP protocol, the app auto-detects which client(s) you have installed. Designed for one-click install: download the DMG, drag to Applications, pair with WhatsApp, click "Configure Claude" — done.

**Everything stays on your Mac.** WhatsApp messages, auth state, and configuration never leave the device. The only network endpoint is WhatsApp itself (unavoidable — that's the WA protocol).

## Goals

- **Zero prerequisites** — no Homebrew, no Node, no Terminal, no Docker.
- **Local-only** — no tunnels, no cloud, no third-party servers.
- **Read-only** — never sends messages, never marks anything read, never changes your presence.
- **Configurable** — per-tool toggles in the GUI so you control what Claude can see.

## Status

Active planning. The design — stack, install flow, MCP tool surface, drawbacks — lives in [PLANNING.md](./PLANNING.md). Code to follow.

## License

MIT — see [LICENSE](./LICENSE).
