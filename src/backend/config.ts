// User preferences persisted to ~/Library/Application Support/WhatsAppMCP/
// config.json. Currently just per-tool enable toggles. The --mcp subprocess
// reads this on startup; the GUI writes it (changes take effect on the next
// Claude restart, when the subprocess respawns).

import { readFileSync, writeFileSync } from 'fs';
import { TOOLS, type ToolName } from '../types/tools';
import type { UserConfig } from '../types/ipc';
import { configPath, ensureAppDirs } from './paths';
import { log } from './logger';

export function defaultConfig(): UserConfig {
  const enabled_tools = {} as Record<ToolName, boolean>;
  for (const t of TOOLS) enabled_tools[t.name] = t.enabledByDefault;
  return { enabled_tools };
}

/** Load config, filling in any missing tool keys from the defaults. */
export function loadConfig(): UserConfig {
  const base = defaultConfig();
  let parsed: Partial<UserConfig> | null = null;
  try {
    parsed = JSON.parse(readFileSync(configPath, 'utf8')) as Partial<UserConfig>;
  } catch {
    return base; // missing or unreadable -> defaults
  }
  const enabled = parsed?.enabled_tools ?? {};
  for (const t of TOOLS) {
    const v = (enabled as Record<string, unknown>)[t.name];
    if (typeof v === 'boolean') base.enabled_tools[t.name] = v;
  }
  return base;
}

export function saveConfig(config: UserConfig): UserConfig {
  ensureAppDirs();
  try {
    writeFileSync(configPath, JSON.stringify(config, null, 2));
  } catch (err) {
    log.error('failed to write config', err);
    throw err;
  }
  return config;
}

/** Merge a partial patch into the stored config and persist it. */
export function patchConfig(patch: Partial<UserConfig>): UserConfig {
  const current = loadConfig();
  const next: UserConfig = {
    enabled_tools: { ...current.enabled_tools, ...(patch.enabled_tools ?? {}) },
  };
  return saveConfig(next);
}
