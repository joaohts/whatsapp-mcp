// Wire protocol between the daemon (long-running Baileys owner) and the MCP
// subprocess (spawned by Claude). Newline-delimited JSON over a Unix domain
// socket at ~/.whatsapp-mcp/daemon.sock. Tiny on purpose — only the two
// stateful tools need delegation; everything else reads SQLite directly.

import { join } from 'path';
import { appSupportDir } from '../backend/paths';

export function daemonSocketPath(): string {
  return join(appSupportDir, 'daemon.sock');
}

export function daemonPidPath(): string {
  return join(appSupportDir, 'daemon.pid');
}

export type DaemonRequest =
  | { op: 'ping' }
  | {
      op: 'fetch_history';
      chat_id: string;
      before_timestamp?: number;
      count: number;
    }
  | { op: 'download_media'; chat_id: string; message_id: string };

export type DaemonResponse<T = unknown> =
  | { ok: true; result: T }
  | { ok: false; error: string };

export interface PingResult {
  alive: true;
  paired: boolean;
  connected: boolean;
  version: string;
}

export interface FetchHistoryResult {
  fetched_count: number;
  oldest_in_store_timestamp: number | null;
}

export interface DownloadMediaResult {
  /** Base64-encoded bytes. */
  data: string;
  mime: string;
  type: 'image' | 'video' | 'audio' | 'document' | 'sticker';
}
