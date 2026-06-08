// Used by the MCP subprocess to talk to a running daemon. If the socket file
// is missing, unresponsive, or stale (PID dead), the helpers return null so
// the caller can fall back to a local Baileys connection.
//
// Wire format: one JSON object per line, request → response, half-duplex.

import * as net from 'net';
import { existsSync, readFileSync } from 'fs';
import {
  daemonPidPath,
  daemonSocketPath,
  type DaemonRequest,
  type DaemonResponse,
  type DownloadMediaResult,
  type FetchHistoryResult,
  type PingResult,
} from './daemon-protocol';

const PING_TIMEOUT_MS = 1000;
const CALL_TIMEOUT_MS = 60000;

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPid(): number | null {
  const p = daemonPidPath();
  if (!existsSync(p)) return null;
  try {
    const pid = parseInt(readFileSync(p, 'utf8').trim(), 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

function call<T>(req: DaemonRequest, timeoutMs: number): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    const sock = net.createConnection(daemonSocketPath());
    let buf = '';
    let done = false;

    const settle = (val: T | null) => {
      if (done) return;
      done = true;
      try {
        sock.end();
      } catch {
        /* noop */
      }
      resolve(val);
    };

    const timer = setTimeout(() => settle(null), timeoutMs);

    sock.once('error', () => {
      clearTimeout(timer);
      settle(null);
    });
    sock.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      const nl = buf.indexOf('\n');
      if (nl < 0) return;
      const line = buf.slice(0, nl);
      try {
        const resp = JSON.parse(line) as DaemonResponse<T>;
        clearTimeout(timer);
        settle(resp.ok ? resp.result : null);
      } catch {
        clearTimeout(timer);
        settle(null);
      }
    });
    sock.once('connect', () => {
      sock.write(JSON.stringify(req) + '\n');
    });
  });
}

/** Returns null if no daemon is reachable. */
export async function daemonPing(): Promise<PingResult | null> {
  // Fast-path: if the PID file is missing or the PID isn't alive, don't even
  // try the socket (avoids hangs on a stale socket file).
  const pid = readPid();
  if (pid != null && !isProcessAlive(pid)) return null;
  if (!existsSync(daemonSocketPath())) return null;
  return call<PingResult>({ op: 'ping' }, PING_TIMEOUT_MS);
}

export async function daemonFetchHistory(
  chat_id: string,
  before_timestamp: number | undefined,
  count: number,
): Promise<FetchHistoryResult | null> {
  return call<FetchHistoryResult>(
    { op: 'fetch_history', chat_id, before_timestamp, count },
    CALL_TIMEOUT_MS,
  );
}

export async function daemonDownloadMedia(
  chat_id: string,
  message_id: string,
): Promise<DownloadMediaResult | null> {
  return call<DownloadMediaResult>(
    { op: 'download_media', chat_id, message_id },
    CALL_TIMEOUT_MS,
  );
}
