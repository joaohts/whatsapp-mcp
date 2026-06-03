// Idempotently patch Claude Desktop's config so it spawns this app in --mcp
// mode. The user never edits JSON; the GUI's "Configure Claude Desktop" button
// calls configureClaudeDesktop() on the controller, which calls this.

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { app } from 'electron';
import { claudeDesktopConfigPath } from './paths';
import { log } from './logger';

const SERVER_KEY = 'whatsapp';

interface ClaudeConfig {
  mcpServers?: Record<string, { command: string; args?: string[] }>;
  [k: string]: unknown;
}

/** The command Claude Desktop should spawn — the currently running binary. */
function mcpCommand(): { command: string; args: string[] } {
  // In a packaged build process.execPath is the WhatsAppMCP.app binary, which
  // knows where its bundled app lives — passing the app path would actually
  // confuse Electron. In dev mode process.execPath is the generic Electron
  // binary in node_modules, so we have to tell it which project to load,
  // otherwise it opens the default "no app" splash window and writes
  // "Electron <version>…" to stdout, which Claude tries to parse as JSON-RPC.
  const args = app.isPackaged
    ? ['--mcp']
    : [app.getAppPath(), '--mcp'];
  return { command: process.execPath, args };
}

export function configureClaudeDesktop(): {
  patched: boolean;
  configPath: string;
} {
  const desired = mcpCommand();
  let config: ClaudeConfig = {};
  try {
    config = JSON.parse(
      readFileSync(claudeDesktopConfigPath, 'utf8'),
    ) as ClaudeConfig;
  } catch {
    config = {}; // missing or unparseable -> start fresh (we own only our key)
  }

  if (!config.mcpServers || typeof config.mcpServers !== 'object') {
    config.mcpServers = {};
  }

  const existing = config.mcpServers[SERVER_KEY];
  const isCurrent =
    existing &&
    existing.command === desired.command &&
    Array.isArray(existing.args) &&
    existing.args.length === desired.args.length &&
    existing.args.every((a, i) => a === desired.args[i]);

  if (isCurrent) {
    return { patched: false, configPath: claudeDesktopConfigPath };
  }

  config.mcpServers[SERVER_KEY] = desired;
  mkdirSync(dirname(claudeDesktopConfigPath), { recursive: true });
  writeFileSync(claudeDesktopConfigPath, JSON.stringify(config, null, 2));
  log.info('patched Claude Desktop config', desired.command);
  return { patched: true, configPath: claudeDesktopConfigPath };
}
