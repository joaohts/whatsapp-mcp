// `whatsapp-mcp serve` — runs the MCP server on stdio for Claude Code (or any
// other MCP client) to consume. This is what Claude Code spawns as the
// subprocess after registration. Pure stdio JSON-RPC; no GUI, no Electron.

import './env';
import { runMcpServer } from '../mcp/server';

export async function serve(): Promise<void> {
  await runMcpServer();
}
