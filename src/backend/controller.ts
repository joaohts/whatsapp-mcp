// BackendController implementation. Runs in the Electron main (GUI) process;
// the GUI agent's code bridges these methods over IPC to the renderer. Wraps
// the store, the read-only WhatsApp connection, user config, and the Claude
// Desktop integration.

import { Store } from '../store';
import { WhatsAppConnection } from '../baileys';
import { ensureAppDirs, storeDbPath, logsDir, mcpPidPath } from './paths';
import { configureLogger, log } from './logger';
import { loadConfig, patchConfig } from './config';
import { configureClaudeDesktop } from './claude-config';
import { join } from 'path';
import { readFileSync } from 'fs';

/** True if the --mcp subprocess (Claude's) is currently alive. Reads the
 *  PID file the subprocess maintains and tests it with a no-op kill. */
function isMcpSubprocessAlive(): boolean {
  try {
    const raw = readFileSync(mcpPidPath, 'utf8').trim();
    const pid = Number(raw);
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) {
      return false;
    }
    process.kill(pid, 0); // signal 0 = existence check, throws if gone
    return true;
  } catch {
    return false;
  }
}
import type {
  BackendController,
  BackendStatus,
  PairingEvent,
  SyncProgress,
  Unsubscribe,
  UserConfig,
} from '../types/ipc';

export class BackendControllerImpl implements BackendController {
  private store: Store | null = null;
  private connection: WhatsAppConnection | null = null;

  async start(): Promise<void> {
    if (this.connection) return;
    ensureAppDirs();
    configureLogger({ file: join(logsDir, 'gui.log'), level: 'info' });
    this.store = new Store(storeDbPath);

    // One-shot repair: rows persisted before the mapper learned to look at
    // msg.participant landed with null sender for every @lid group message.
    // Re-extracts sender from raw_proto and writes it back. Idempotent —
    // subsequent launches no-op once the store is clean.
    try {
      const { backfillGroupSenders } = await import('../baileys/backfill');
      backfillGroupSenders(this.store);
    } catch (err) {
      log.warn('backfillGroupSenders failed', err);
    }

    this.connection = new WhatsAppConnection(this.store);

    // Once Baileys reports connected, run a one-shot lid backfill so group
    // message senders resolve to a contact name. Fires asynchronously so the
    // GUI doesn't wait on it. Idempotent.
    const conn = this.connection;
    const store = this.store;
    const offStatus = conn.on('status', (status) => {
      if (status.connection !== 'connected') return;
      offStatus();
      void import('../baileys/backfill').then(({ backfillContactLids }) =>
        backfillContactLids(store, conn).catch((err) =>
          log.warn('backfillContactLids failed', err),
        ),
      );
    });

    await this.connection.start();
    log.info('backend controller started');
  }

  async stop(): Promise<void> {
    if (this.connection) {
      await this.connection.stop();
      this.connection = null;
    }
    if (this.store) {
      this.store.close();
      this.store = null;
    }
  }

  // ---- status ----
  async getStatus(): Promise<BackendStatus> {
    if (!this.connection) {
      return {
        connection: 'disconnected',
        paired_account: null,
        last_sync_at: null,
        last_error: null,
        store_chat_count: 0,
        store_message_count: 0,
      };
    }
    return this.connection.getStatus();
  }

  onStatusChange(handler: (status: BackendStatus) => void): Unsubscribe {
    return this.requireConnection().on('status', handler);
  }

  // ---- pairing ----
  async startPairing(opts: {
    method: 'qr' | 'code';
    phoneE164?: string;
  }): Promise<void> {
    await this.requireStarted();
    await this.connection!.startPairing(opts);
  }

  onPairingEvent(handler: (event: PairingEvent) => void): Unsubscribe {
    return this.requireConnection().on('pairing', handler);
  }

  async cancelPairing(): Promise<void> {
    if (this.connection) await this.connection.cancelPairing();
  }

  async unlinkDevice(): Promise<void> {
    if (this.connection) await this.connection.unlink();
  }

  // ---- sync ----
  async syncNow(): Promise<void> {
    await this.requireStarted();
    // Force a fresh connection cycle so WhatsApp re-pushes anything missed
    // while the socket was dormant. History lands via onSyncProgress.
    await this.connection!.stop();
    await this.connection!.start();
  }

  /**
   * Reclaim the Baileys socket for this process (the GUI). Refuses if the
   * --mcp subprocess is alive — that means Claude is open and we'd kick
   * its tool calls. Otherwise drops + restarts our connection so the GUI
   * regains ownership cleanly.
   */
  async reclaimConnection(): Promise<{
    reclaimed: boolean;
    reason?: 'claude_active';
  }> {
    if (isMcpSubprocessAlive()) {
      return { reclaimed: false, reason: 'claude_active' };
    }
    await this.requireStarted();
    await this.connection!.stop();
    await this.connection!.start();
    return { reclaimed: true };
  }

  onSyncProgress(handler: (progress: SyncProgress) => void): Unsubscribe {
    return this.requireConnection().on('sync', handler);
  }

  // ---- config ----
  async getConfig(): Promise<UserConfig> {
    return loadConfig();
  }

  async setConfig(patch: Partial<UserConfig>): Promise<UserConfig> {
    return patchConfig(patch);
  }

  // ---- Claude Desktop ----
  async configureClaudeDesktop(): Promise<{
    patched: boolean;
    configPath: string;
  }> {
    return configureClaudeDesktop();
  }

  // ---- internals ----
  private async requireStarted(): Promise<void> {
    if (!this.connection) await this.start();
  }

  private requireConnection(): WhatsAppConnection {
    if (!this.connection) {
      throw new Error('Backend not started — call start() first');
    }
    return this.connection;
  }
}

export function createBackendController(): BackendController {
  return new BackendControllerImpl();
}
