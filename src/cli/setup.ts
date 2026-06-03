// `whatsapp-mcp setup` — orchestrates first-time install:
//   1. Run the terminal pairing flow (QR or pairing code).
//   2. Build the absolute command Claude Code should spawn.
//   3. Show a diff of what we'd write to ~/.claude.json and ask to confirm.
//   4. Write it.
//
// Designed to be agent-driven too: --phone, --method, and --yes flags skip
// every prompt so Claude Code can run this end-to-end unattended.

import './env';
import { resolve } from 'path';
import { existsSync } from 'fs';
import * as readline from 'readline';
import { pair, qrPngPath, type PairOptions } from './pair';
import { planPatch, applyPatch } from './claude-code-config';

export interface SetupOptions {
  method?: 'qr' | 'code';
  phoneE164?: string;
  /** If true, skip all confirmation prompts. */
  yes?: boolean;
}

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  return new Promise<string>((res) => {
    rl.question(question, (answer) => {
      rl.close();
      res(answer.trim());
    });
  });
}

async function chooseMethod(opts: SetupOptions): Promise<PairOptions> {
  if (opts.method === 'qr') return { method: 'qr' };
  if (opts.method === 'code') {
    if (!opts.phoneE164) throw new Error('--phone is required when --method=code');
    return { method: 'code', phoneE164: opts.phoneE164 };
  }
  if (opts.phoneE164) {
    return { method: 'code', phoneE164: opts.phoneE164 };
  }
  if (opts.yes) {
    return { method: 'qr' };
  }
  const choice = await ask('Pair with [Q]R code or pairing [C]ode? (Q/c): ');
  if (choice.toLowerCase().startsWith('c')) {
    const phone = await ask('Phone number (E.164, e.g. +5511999999999): ');
    return { method: 'code', phoneE164: phone };
  }
  return { method: 'qr' };
}

function resolveServeCommand(): { command: string; args: string[] } {
  // Prefer the bin shim — stable across `npm install` / updates.
  // When invoked via `npm run setup` or `node dist/cli/main.js setup`,
  // the project root is process.cwd() (set by npm) or two-up from this file.
  const cwd = process.cwd();
  const candidates = [
    resolve(cwd, 'bin/whatsapp-mcp'),
    resolve(__dirname, '..', '..', 'bin', 'whatsapp-mcp'),
  ];
  const bin = candidates.find((p) => existsSync(p));
  if (bin) {
    return { command: bin, args: ['serve'] };
  }
  // Fallback: invoke the compiled main directly.
  return {
    command: process.execPath,
    args: [resolve(__dirname, 'main.js'), 'serve'],
  };
}

export async function setup(opts: SetupOptions): Promise<void> {
  const pairOpts = await chooseMethod(opts);

  // In --yes (agent) mode with QR, suppress the ASCII QR — it's noise in the
  // tool transcript. The CLI will auto-open the PNG in Preview, which is how
  // the user actually sees the QR on shared (local) Macs.
  if (opts.yes && pairOpts.method === 'qr') {
    pairOpts.suppressAsciiQr = true;
    process.stderr.write(
      '\n→ Pairing via QR. The QR will be written to and opened from:\n' +
        `    ${qrPngPath()}\n` +
        '  macOS Preview will pop up with the QR. The user scans it with WhatsApp.\n',
    );
  }

  process.stderr.write('\n→ Starting pairing…\n');
  const result = await pair(pairOpts);
  process.stderr.write(`✓ Paired as ${result.account.name}.\n\n`);

  const { command, args } = resolveServeCommand();
  const plan = planPatch(command, args);

  if (!plan.needsUpdate) {
    process.stderr.write('✓ Claude Code config already up to date — nothing to write.\n');
    return;
  }

  process.stderr.write('Will patch Claude Code config:\n');
  process.stderr.write('  ' + plan.diff.split('\n').join('\n  ') + '\n\n');

  if (!opts.yes) {
    const answer = await ask('Apply this change? [Y/n]: ');
    if (answer && !answer.toLowerCase().startsWith('y')) {
      process.stderr.write('Skipped. You can re-run `whatsapp-mcp setup` later.\n');
      return;
    }
  }

  applyPatch(plan);
  process.stderr.write(
    `✓ Wrote ${plan.configPath}.\n` +
      '  Restart any open Claude Code session, then ask:\n' +
      '    "what are my unread WhatsApp chats?"\n',
  );
}
