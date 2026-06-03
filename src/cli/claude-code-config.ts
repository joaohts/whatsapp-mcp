// Patches Claude Code's user-scope config (~/.claude.json) to register this
// MCP server. Idempotent — re-running is safe and a no-op when already current.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
import { claudeCodeConfigPath } from '../backend/paths';

const SERVER_KEY = 'whatsapp';

interface ClaudeCodeConfig {
  mcpServers?: Record<string, { command: string; args?: string[] }>;
  [k: string]: unknown;
}

export interface PatchPlan {
  configPath: string;
  command: string;
  args: string[];
  /** Whether the config currently lacks an up-to-date whatsapp entry. */
  needsUpdate: boolean;
  /** Pretty diff string for user confirmation. */
  diff: string;
}

export function planPatch(serveCommand: string, serveArgs: string[]): PatchPlan {
  const desired = { command: serveCommand, args: serveArgs };

  let config: ClaudeCodeConfig = {};
  if (existsSync(claudeCodeConfigPath)) {
    try {
      config = JSON.parse(readFileSync(claudeCodeConfigPath, 'utf8')) as ClaudeCodeConfig;
    } catch {
      config = {};
    }
  }

  const existing = config.mcpServers?.[SERVER_KEY];
  const isCurrent =
    existing &&
    existing.command === desired.command &&
    Array.isArray(existing.args) &&
    existing.args.length === desired.args.length &&
    existing.args.every((a, i) => a === desired.args[i]);

  const before = existing
    ? `"${SERVER_KEY}": ${JSON.stringify(existing, null, 2)}`
    : `(none)`;
  const after = `"${SERVER_KEY}": ${JSON.stringify(desired, null, 2)}`;
  const diff = `${claudeCodeConfigPath}\n  before: ${before}\n  after:  ${after}`;

  return {
    configPath: claudeCodeConfigPath,
    command: serveCommand,
    args: serveArgs,
    needsUpdate: !isCurrent,
    diff,
  };
}

export function applyPatch(plan: PatchPlan): void {
  let config: ClaudeCodeConfig = {};
  if (existsSync(plan.configPath)) {
    try {
      config = JSON.parse(readFileSync(plan.configPath, 'utf8')) as ClaudeCodeConfig;
    } catch {
      config = {};
    }
  }
  if (!config.mcpServers || typeof config.mcpServers !== 'object') {
    config.mcpServers = {};
  }
  config.mcpServers[SERVER_KEY] = { command: plan.command, args: plan.args };
  mkdirSync(dirname(plan.configPath), { recursive: true });
  writeFileSync(plan.configPath, JSON.stringify(config, null, 2));
}
