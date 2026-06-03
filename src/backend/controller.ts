// BackendController implementation. Runs in the Electron main (GUI) process;
// the GUI agent's code bridges these methods over IPC to the renderer. Wraps
// the store, the read-only WhatsApp connection, user config, and the Claude
// Desktop integration.

import { Store } from '../store';
import { WhatsAppConnection } from '../baileys';
import { ensureAppDirs, storeDbPath, logsDir } from './paths';
import { configureLogger, log } from './logger';
import { loadConfig, patchConfig } from './config';
import { configureClaudeDesktop } from './claude-config';
import { join } from 'path';
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
    this.connection = new WhatsAppConnection(this.store);
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
