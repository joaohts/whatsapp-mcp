// `whatsapp-mcp daemon` — long-running Baileys connection that keeps the local
// SQLite store warm. Designed to be run as a systemd --user service on a Pi
// (or anywhere a background process makes sense). When the MCP subprocess is
// spawned by Claude, it talks to this daemon over ~/.whatsapp-mcp/daemon.sock
// for the two stateful tools (fetch_more_history, download_media) and reads
// SQLite directly for everything else.
//
// One Baileys socket per linked device; the daemon holds it forever. MCP
// subprocesses must never connect their own when the daemon is alive.

import './env';
import * as net from 'net';
import {
  unlinkSync,
  existsSync,
  writeFileSync,
  readFileSync,
} from 'fs';
import { Store } from '../store';
import { WhatsAppConnection } from '../baileys';
import {
  ensureAppDirs,
  storeDbPath,
  logsDir,
} from '../backend/paths';
import { configureLogger, log } from '../backend/logger';
import { join } from 'path';
import {
  daemonPidPath,
  daemonSocketPath,
  type DaemonRequest,
  type DaemonResponse,
} from './daemon-protocol';

const APP_VERSION = '0.0.1';

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function abortIfDaemonAlreadyRunning(): void {
  const p = daemonPidPath();
  if (!existsSync(p)) return;
  try {
    const pid = parseInt(readFileSync(p, 'utf8').trim(), 10);
    if (Number.isFinite(pid) && isProcessAlive(pid)) {
      throw new Error(
        `daemon already running (pid ${pid}); refuse to start a second one`,
      );
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('daemon already running'))
      throw err;
    // unreadable pid file → ignore and proceed
  }
}

function writePidFile(): void {
  writeFileSync(daemonPidPath(), String(process.pid));
}

function removeFileIfPresent(path: string): void {
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    /* non-fatal */
  }
}

function buildHandler(connection: WhatsAppConnection) {
  return async function handle(req: DaemonRequest): Promise<DaemonResponse> {
    try {
      switch (req.op) {
        case 'ping':
          return {
            ok: true,
            result: {
              alive: true,
              paired: connection.isConnected(),
              connected: connection.isConnected(),
              version: APP_VERSION,
            },
          };
        case 'fetch_history': {
          const r = await connection.fetchMoreHistory(
            req.chat_id,
            req.before_timestamp,
            req.count,
          );
          return { ok: true, result: r };
        }
        case 'download_media': {
          const r = await connection.downloadMedia(req.chat_id, req.message_id);
          if (!r) {
            return { ok: false, error: 'no downloadable media for that message' };
          }
          return {
            ok: true,
            result: {
              data: r.data.toString('base64'),
              mime: r.mime,
              type: r.type as 'image' | 'video' | 'audio' | 'document' | 'sticker',
            },
          };
        }
        default:
          return { ok: false, error: `unknown op` };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: msg };
    }
  };
}

export async function runDaemon(): Promise<void> {
  abortIfDaemonAlreadyRunning();
  ensureAppDirs();
  configureLogger({ file: join(logsDir, 'daemon.log'), level: 'info' });
  log.info('--- whatsapp-mcp daemon starting ---');

  const store = new Store(storeDbPath);
  const connection = new WhatsAppConnection(store);

  // One-shot repair for rows whose @lid sender was dropped by the pre-fix
  // mapper. Idempotent — re-running is a no-op once the store is clean.
  try {
    const { backfillGroupSenders } = await import('../baileys/backfill');
    backfillGroupSenders(store);
  } catch (err) {
    log.warn('backfillGroupSenders failed', err);
  }

  writePidFile();
  removeFileIfPresent(daemonSocketPath());

  const handle = buildHandler(connection);
  const server = net.createServer((sock) => {
    let buf = '';
    sock.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      let nl: number;
      // eslint-disable-next-line no-cond-assign
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let req: DaemonRequest;
        try {
          req = JSON.parse(line) as DaemonRequest;
        } catch {
          sock.write(
            JSON.stringify({ ok: false, error: 'malformed JSON' }) + '\n',
          );
          continue;
        }
        void handle(req).then((resp) => {
          try {
            sock.write(JSON.stringify(resp) + '\n');
          } catch {
            /* peer closed early */
          }
        });
      }
    });
    sock.on('error', () => {
      /* peer hung up */
    });
  });

  server.listen(daemonSocketPath(), () => {
    log.info(`IPC socket listening at ${daemonSocketPath()}`);
  });

  // Bring Baileys up. Errors are logged but don't kill the daemon —
  // we want it to keep trying and the store to stay readable.
  connection.start().catch((err) => log.error('connection.start failed', err));

  // Once Baileys reports connected, run a one-shot lid backfill: walk every
  // group in the store and ask WA for its participant list (which carries
  // both jid and lid per member) so future group messages resolve to a
  // contact name. Idempotent + best-effort.
  const offStatus = connection.on('status', (status) => {
    if (status.connection !== 'connected') return;
    offStatus(); // only run once per daemon lifetime
    void import('../baileys/backfill').then(({ backfillContactLids }) =>
      backfillContactLids(store, connection).catch((err) =>
        log.warn('backfillContactLids failed', err),
      ),
    );
  });

  let stopping = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    log.info(`got ${signal}, stopping`);
    try {
      await connection.stop();
    } catch (err) {
      log.warn('connection.stop error', err);
    }
    server.close();
    removeFileIfPresent(daemonSocketPath());
    removeFileIfPresent(daemonPidPath());
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // Keep alive forever — the Baileys socket + IPC server already keep the
  // event loop busy, but this makes it explicit.
  await new Promise<void>(() => undefined);
}
