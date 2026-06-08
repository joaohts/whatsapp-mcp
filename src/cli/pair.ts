// Terminal pairing flow. Drives the existing WhatsAppConnection's
// startPairing() and renders pairing events to stdout / stderr.
//
// - QR mode: renders QR as ASCII via qrcode-terminal (interactive use) AND
//   saves a PNG of the latest QR to ~/.whatsapp-mcp/pairing-qr.png so
//   agent-driven flows can `Read` the file to display the QR inline in chat.
//   WhatsApp rotates the QR ~every 60s; the PNG is overwritten on each
//   rotation, so the file always reflects the current valid QR.
// - Code mode: prints the 8-character pairing code prominently.
//
// Returns when the socket reports either success or unrecoverable error.

import './env';
import { Store } from '../store';
import { WhatsAppConnection } from '../baileys';
import {
  appSupportDir,
  ensureAppDirs,
  storeDbPath,
  configPath,
} from '../backend/paths';
import { existsSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { spawn } from 'child_process';
import * as qrcodePng from 'qrcode';
import { defaultConfig } from '../backend/config';
import type { PairingEvent } from '../types/ipc';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const qrcodeTerminal = require('qrcode-terminal') as {
  generate: (data: string, opts: { small: boolean }, cb: (out: string) => void) => void;
};

export interface PairOptions {
  method: 'qr' | 'code';
  /** Required when method === 'code'. E.164 without spaces or '+'. */
  phoneE164?: string;
  /** If true, suppress the ASCII QR (still writes the PNG). For agent runs. */
  suppressAsciiQr?: boolean;
  /** If true, don't run `open` on the QR PNG (default: open on first QR). */
  noOpenQr?: boolean;
}

export interface PairResult {
  account: { name: string; number: string };
}

export function qrPngPath(): string {
  return join(appSupportDir, 'pairing-qr.png');
}

/** Raw QR payload. The `watch-qr` subcommand reads this. */
export function qrTxtPath(): string {
  return join(appSupportDir, 'pairing-qr.txt');
}

/** Sentinel file created when pairing succeeds. `watch-qr` watches it to exit. */
export function pairingCompletePath(): string {
  return join(appSupportDir, 'pairing-complete');
}

function clearStaleSentinels(): void {
  try {
    if (existsSync(pairingCompletePath())) unlinkSync(pairingCompletePath());
  } catch {
    /* non-fatal */
  }
}

function writeQrTxt(payload: string): void {
  try {
    writeFileSync(qrTxtPath(), payload);
  } catch {
    /* non-fatal */
  }
}

function markPairingComplete(): void {
  try {
    writeFileSync(pairingCompletePath(), '');
  } catch {
    /* non-fatal */
  }
}

function ensureConfigFile(): void {
  if (!existsSync(configPath)) {
    writeFileSync(configPath, JSON.stringify(defaultConfig(), null, 2));
  }
}

function renderAsciiQr(payload: string): void {
  qrcodeTerminal.generate(payload, { small: true }, (out) => {
    process.stderr.write('\n' + out + '\n');
  });
}

async function writeQrPng(payload: string): Promise<string> {
  const path = qrPngPath();
  await qrcodePng.toFile(path, payload, { width: 512, margin: 2 });
  return path;
}

function openInPreview(path: string): void {
  // macOS-only. Fire and forget — failures are non-fatal (user can `open`
  // manually). spawn with detached + unref so we don't hold a child handle.
  try {
    const child = spawn('open', [path], { stdio: 'ignore', detached: true });
    // ENOENT (e.g. on Linux where `open` doesn't exist) surfaces as an async
    // 'error' event, not a sync throw. Swallow it so the pairing flow survives.
    child.on('error', () => {
      /* non-fatal */
    });
    child.unref();
  } catch {
    /* non-fatal */
  }
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
  clearStaleSentinels();
  const store = new Store(storeDbPath);
  const connection = new WhatsAppConnection(store);

  let openedQrOnce = false;

  return await new Promise<PairResult>((resolve, reject) => {
    const unsubscribe = connection.on('pairing', (e: PairingEvent) => {
      switch (e.kind) {
        case 'qr':
          // Write raw payload for any external watcher (e.g. `whatsapp-mcp
          // watch-qr` in a separate terminal).
          writeQrTxt(e.payload);
          // Write the PNG. On the first QR, auto-launch Preview so the user
          // doesn't need any image-rendering chat UI. On rotations
          // (~every 60s), overwrite the file — Preview will keep showing
          // the first QR, but the file on disk is current if the user
          // re-opens it.
          writeQrPng(e.payload)
            .then((path) => {
              process.stderr.write(
                `\n  QR saved to: ${path}\n`,
              );
              if (!opts.noOpenQr && !openedQrOnce) {
                openInPreview(path);
                openedQrOnce = true;
                process.stderr.write(
                  '  Opened in Preview. Scan with WhatsApp on your phone →\n' +
                    '  Settings → Linked Devices → Link a Device. If the QR\n' +
                    '  expires (after ~60s), run `open ' + path + '` to refresh.\n',
                );
              } else if (opts.noOpenQr) {
                process.stderr.write(
                  '  To display: `open ' + path + '` or read the file in your client.\n',
                );
              }
            })
            .catch(() => {
              /* non-fatal */
            });
          if (!opts.suppressAsciiQr) {
            renderAsciiQr(e.payload);
          }
          break;
        case 'code':
          renderCode(e.code);
          break;
        case 'success':
          markPairingComplete();
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
    });

    connection.startPairing(opts).catch((err: unknown) => {
      unsubscribe();
      reject(err instanceof Error ? err : new Error(String(err)));
    });
  });
}
