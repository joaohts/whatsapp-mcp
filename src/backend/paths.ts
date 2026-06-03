// Centralised filesystem locations. All app state lives OUTSIDE the .app
// bundle so it survives reinstalls and drag-replace updates (see PLANNING.md
// "Install & runtime").
//
// The CLI variant overrides the base directory by exporting WHATSAPP_MCP_HOME
// before any import of this file. When set, the CLI's state lives there
// (typically ~/.whatsapp-mcp/) instead of ~/Library/Application Support/.
// The DMG variant never sets this env var, so it gets the original paths.

import { homedir } from 'os';
import { join } from 'path';
import { mkdirSync } from 'fs';

const APP_NAME = 'WhatsAppMCP';

const home = homedir();

const customHome = process.env.WHATSAPP_MCP_HOME;

/** ~/Library/Application Support/WhatsAppMCP — or $WHATSAPP_MCP_HOME if set */
export const appSupportDir = customHome
  ? customHome
  : join(home, 'Library', 'Application Support', APP_NAME);

/** ~/Library/Logs/WhatsAppMCP — or $WHATSAPP_MCP_HOME/logs if set */
export const logsDir = customHome
  ? join(customHome, 'logs')
  : join(home, 'Library', 'Logs', APP_NAME);

/** Baileys multi-file auth state. */
export const authDir = join(appSupportDir, 'auth');

/** SQLite store. */
export const storeDbPath = join(appSupportDir, 'store.db');

/** User preferences (tool toggles, etc.). */
export const configPath = join(appSupportDir, 'config.json');

/** --mcp mode log file. */
export const mcpLogPath = join(logsDir, 'mcp.log');

/** PID file written by the --mcp subprocess. The GUI reads + tests with
 *  process.kill(pid, 0) before reclaiming the Baileys socket, so it doesn't
 *  accidentally kick Claude's live MCP session. */
export const mcpPidPath = join(appSupportDir, 'mcp.pid');

/** Claude Desktop config that we idempotently patch. */
export const claudeDesktopConfigPath = join(
  home,
  'Library',
  'Application Support',
  'Claude',
  'claude_desktop_config.json',
);

/** Claude Code user-scope config. */
export const claudeCodeConfigPath = join(home, '.claude.json');

/** Ensure the directories we own exist. Safe to call repeatedly. */
export function ensureAppDirs(): void {
  mkdirSync(appSupportDir, { recursive: true });
  mkdirSync(authDir, { recursive: true });
  mkdirSync(logsDir, { recursive: true });
}
