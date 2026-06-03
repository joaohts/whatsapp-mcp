// CLI entry: parses argv and dispatches to a subcommand.
//
// Subcommands:
//   setup    — pair + register with Claude Code (interactive by default,
//              fully scriptable via flags)
//   pair     — pair only (terminal QR or code)
//   serve    — run the MCP server on stdio (this is what Claude Code spawns)
//   status   — show pairing state + paths
//   version  — print version
//   help     — usage

import './env';

const USAGE = `whatsapp-mcp — read-only WhatsApp for Claude Code

Usage:
  whatsapp-mcp setup [--method qr|code] [--phone +5511...] [--yes]
  whatsapp-mcp pair  [--method qr|code] [--phone +5511...]
  whatsapp-mcp serve
  whatsapp-mcp status
  whatsapp-mcp version

State lives under \$WHATSAPP_MCP_HOME (default: ~/.whatsapp-mcp/).
`;

interface ParsedArgs {
  cmd: string;
  flags: Record<string, string | boolean>;
}

function parse(argv: string[]): ParsedArgs {
  const [cmd = 'help', ...rest] = argv;
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith('--')) {
      flags[key] = true;
    } else {
      flags[key] = next;
      i++;
    }
  }
  return { cmd, flags };
}

function methodFromFlag(v: unknown): 'qr' | 'code' | undefined {
  if (v === 'qr' || v === 'code') return v;
  return undefined;
}

async function main(): Promise<void> {
  const { cmd, flags } = parse(process.argv.slice(2));

  switch (cmd) {
    case 'setup': {
      const { setup } = await import('./setup');
      await setup({
        method: methodFromFlag(flags.method),
        phoneE164: typeof flags.phone === 'string' ? flags.phone : undefined,
        yes: flags.yes === true,
      });
      break;
    }
    case 'pair': {
      const { pair } = await import('./pair');
      await pair({
        method: methodFromFlag(flags.method) ?? 'qr',
        phoneE164: typeof flags.phone === 'string' ? flags.phone : undefined,
      });
      break;
    }
    case 'serve': {
      const { serve } = await import('./serve');
      await serve();
      break;
    }
    case 'status': {
      const { showStatus } = await import('./status');
      await showStatus();
      break;
    }
    case 'version': {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const pkg = require('../../package.json') as { version: string };
      process.stdout.write(pkg.version + '\n');
      break;
    }
    case 'help':
    case '--help':
    case '-h':
    default:
      process.stdout.write(USAGE);
      if (cmd !== 'help' && cmd !== '--help' && cmd !== '-h') {
        process.exitCode = 1;
      }
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`error: ${msg}\n`);
  process.exit(1);
});
