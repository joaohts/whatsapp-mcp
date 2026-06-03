// `whatsapp-mcp status` — reports paths and pairing state without bringing up
// the WhatsApp socket. Reads the auth dir on disk.

import './env';
import { existsSync, readdirSync } from 'fs';
import {
  appSupportDir,
  authDir,
  storeDbPath,
  configPath,
  logsDir,
  claudeCodeConfigPath,
} from '../backend/paths';

export async function showStatus(): Promise<void> {
  const paired = existsSync(authDir) && readdirSync(authDir).length > 0;
  const storeExists = existsSync(storeDbPath);
  const configExists = existsSync(configPath);
  const claudeConfigured = (() => {
    if (!existsSync(claudeCodeConfigPath)) return false;
    try {
      const { readFileSync } = require('fs') as typeof import('fs');
      const parsed = JSON.parse(readFileSync(claudeCodeConfigPath, 'utf8')) as {
        mcpServers?: Record<string, unknown>;
      };
      return Boolean(parsed.mcpServers && 'whatsapp' in parsed.mcpServers);
    } catch {
      return false;
    }
  })();

  process.stdout.write(
    [
      `state dir:     ${appSupportDir}`,
      `auth dir:      ${authDir} ${paired ? '(present)' : '(empty)'}`,
      `store db:      ${storeDbPath} ${storeExists ? '(present)' : '(missing)'}`,
      `config:        ${configPath} ${configExists ? '(present)' : '(missing)'}`,
      `logs:          ${logsDir}`,
      `claude code:   ${claudeCodeConfigPath} ${claudeConfigured ? '(configured)' : '(not configured)'}`,
      `paired:        ${paired ? 'yes' : 'no'}`,
      '',
    ].join('\n'),
  );
}
