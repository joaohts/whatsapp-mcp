// Terminal pairing flow. Drives the existing WhatsAppConnection's
// startPairing() and renders pairing events to stdout / stderr.
//
// - QR mode: renders QR as ASCII via qrcode-terminal
// - Code mode: prints the 8-character pairing code prominently
//
// Returns when the socket reports either success or unrecoverable error.

import './env';
import { Store } from '../store';
import { WhatsAppConnection } from '../baileys';
import { ensureAppDirs, storeDbPath, configPath } from '../backend/paths';
import { existsSync, writeFileSync } from 'fs';
import { defaultConfig } from '../backend/config';
import type { PairingEvent } from '../types/ipc';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const qrcode = require('qrcode-terminal') as {
  generate: (data: string, opts: { small: boolean }, cb: (out: string) => void) => void;
};

export interface PairOptions {
  method: 'qr' | 'code';
  /** Required when method === 'code'. E.164 without spaces or '+'. */
  phoneE164?: string;
}

export interface PairResult {
  account: { name: string; number: string };
}

function ensureConfigFile(): void {
  if (!existsSync(configPath)) {
    writeFileSync(configPath, JSON.stringify(defaultConfig(), null, 2));
  }
}

function renderQr(payload: string): void {
  qrcode.generate(payload, { small: true }, (out) => {
    // Write to stderr so stdout stays clean for any wrapping script.
    process.stderr.write('\n' + out + '\n');
  });
}

function renderCode(code: string): void {
  const pretty = code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
  process.stderr.write('\n  Pairing code: \x1b[1m' + pretty + '\x1b[0m\n');
  process.stderr.write(
    '  Open WhatsApp on your phone → Settings → Linked Devices →\n' +
      '  Link a Device → "Link with phone number instead" → enter the code.\n\n',
  );
}

export async function pair(opts: PairOptions): Promise<PairResult> {
  ensureAppDirs();
  ensureConfigFile();
  const store = new Store(storeDbPath);
  const connection = new WhatsAppConnection(store);

  return await new Promise<PairResult>((resolve, reject) => {
    const unsubscribe = connection.on(
      'pairing',
      (e: PairingEvent) => {
        switch (e.kind) {
          case 'qr':
            renderQr(e.payload);
            break;
          case 'code':
            renderCode(e.code);
            break;
          case 'success':
            process.stderr.write(
              `\n  Linked as ${e.account.name} (${e.account.number}).\n`,
            );
            unsubscribe();
            resolve({ account: e.account });
            break;
          case 'error':
            unsubscribe();
            reject(new Error(e.message));
            break;
        }
      },
    );

    connection
      .startPairing(opts)
      .catch((err: unknown) => {
        unsubscribe();
        reject(err instanceof Error ? err : new Error(String(err)));
      });
  });
}
