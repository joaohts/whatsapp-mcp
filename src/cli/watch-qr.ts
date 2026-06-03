// `whatsapp-mcp watch-qr` — runs in a separate terminal beside `setup` / `pair`.
// Reads the raw QR payload from ~/.whatsapp-mcp/pairing-qr.txt and re-renders
// an ASCII QR every time the file changes (~every 60s as WhatsApp rotates).
// Exits cleanly when the `pairing-complete` sentinel appears.
//
// Intended use: agent prints "open another terminal and run `whatsapp-mcp
// watch-qr`" while it's running `setup` in its own process. The user sees a
// live-updating QR without the rotation/agent-transcript trade-offs.

import './env';
import { existsSync, readFileSync, watchFile, unwatchFile } from 'fs';
import { qrTxtPath, pairingCompletePath } from './pair';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const qrcodeTerminal = require('qrcode-terminal') as {
  generate: (data: string, opts: { small: boolean }, cb: (out: string) => void) => void;
};

const CLEAR_SCREEN = '\x1Bc';

function render(payload: string, label: string): void {
  qrcodeTerminal.generate(payload, { small: true }, (out) => {
    process.stdout.write(CLEAR_SCREEN);
    process.stdout.write(`whatsapp-mcp — pairing QR (${label})\n`);
    process.stdout.write(out + '\n');
    process.stdout.write(
      'Scan with WhatsApp → Settings → Linked Devices → Link a Device.\n' +
        'The QR rotates ~every 60s — this terminal will update automatically.\n' +
        'Ctrl-C to quit.\n',
    );
  });
}

function readPayload(): string | null {
  try {
    return existsSync(qrTxtPath()) ? readFileSync(qrTxtPath(), 'utf8') : null;
  } catch {
    return null;
  }
}

export async function watchQr(): Promise<void> {
  const txt = qrTxtPath();
  const done = pairingCompletePath();
  let rotations = 0;

  // Initial render if a QR already exists; otherwise wait.
  const initial = readPayload();
  if (initial) {
    rotations++;
    render(initial, `QR #${rotations}`);
  } else {
    process.stdout.write(
      'Waiting for pairing to start. Run `whatsapp-mcp setup` in another terminal.\n',
    );
  }

  await new Promise<void>((resolve) => {
    watchFile(txt, { interval: 500 }, () => {
      const payload = readPayload();
      if (!payload) return;
      rotations++;
      render(payload, `QR #${rotations}`);
    });

    watchFile(done, { interval: 500 }, () => {
      if (existsSync(done)) {
        process.stdout.write(CLEAR_SCREEN);
        process.stdout.write('✓ Pairing complete. You can close this terminal.\n');
        unwatchFile(txt);
        unwatchFile(done);
        resolve();
      }
    });
  });
}
