// Centralised filesystem locations. All app state lives OUTSIDE the .app
// bundle so it survives reinstalls and drag-replace updates (see PLANNING.md
// "Install & runtime").

import { homedir } from 'os';
import { join } from 'path';
import { mkdirSync } from 'fs';

const APP_NAME = 'WhatsAppMCP';

const home = homedir();

/** ~/Library/Application Support/WhatsAppMCP */
export const appSupportDir = join(
  home,
  'Library',
  'Application Support',
  APP_NAME,
);

/** ~/Library/Logs/WhatsAppMCP */
export const logsDir = join(home, 'Library', 'Logs', APP_NAME);

/** Baileys multi-file auth state. */
export const authDir = join(appSupportDir, 'auth');

/** SQLite store. */
export const storeDbPath = join(appSupportDir, 'store.db');

/** User preferences (tool toggles, etc.). */
export const configPath = join(appSupportDir, 'config.json');

/** --mcp mode log file. */
export const mcpLogPath = join(logsDir, 'mcp.log');

/** Claude Desktop config that we idempotently patch. */
export const claudeDesktopConfigPath = join(
  home,
  'Library',
  'Application Support',
  'Claude',
  'claude_desktop_config.json',
);

/** Ensure the directories we own exist. Safe to call repeatedly. */
export function ensureAppDirs(): void {
  mkdirSync(appSupportDir, { recursive: true });
  mkdirSync(authDir, { recursive: true });
  mkdirSync(logsDir, { recursive: true });
}
