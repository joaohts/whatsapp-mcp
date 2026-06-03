// Mock BackendController — lets the GUI be exercised end-to-end without the
// real Baileys/SQLite backend (backend agent's lane). It fakes pairing,
// initial history sync, status transitions, and config persistence so the
// entire UI is clickable. Swap for the real controller in window.ts once
// src/backend/controller.ts lands.

import type {
  BackendController,
  BackendStatus,
  PairingEvent,
  SyncProgress,
  UserConfig,
  Unsubscribe,
  ConnectionState,
} from '../../types/ipc';
import { TOOLS, type ToolName } from '../../types/tools';

type Handler<T> = (value: T) => void;

class Emitter<T> {
  private handlers = new Set<Handler<T>>();
  on(h: Handler<T>): Unsubscribe {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }
  emit(value: T) {
    for (const h of [...this.handlers]) h(value);
  }
}

function defaultConfig(): UserConfig {
  const enabled_tools = {} as Record<ToolName, boolean>;
  for (const tool of TOOLS) enabled_tools[tool.name] = tool.enabledByDefault;
  return { enabled_tools };
}

const MOCK_ACCOUNT = { name: 'Mock User', number: '+55 11 99999-0000' };
const TARGET_CHATS = 38;
const TARGET_MESSAGES = 1247;

export class MockBackendController implements BackendController {
  private status: BackendStatus = {
    connection: 'unpaired',
    paired_account: null,
    last_sync_at: null,
    last_error: null,
    store_chat_count: 0,
    store_message_count: 0,
  };
  private config = defaultConfig();

  private statusEvents = new Emitter<BackendStatus>();
  private pairingEvents = new Emitter<PairingEvent>();
  private syncEvents = new Emitter<SyncProgress>();

  private timers = new Set<NodeJS.Timeout>();

  // ---- lifecycle ----
  async start(): Promise<void> {
    // Already-paired installs would resume here; the mock always starts fresh.
  }
  async stop(): Promise<void> {
    this.clearTimers();
  }

  // ---- status ----
  async getStatus(): Promise<BackendStatus> {
    return this.status;
  }
  onStatusChange(handler: Handler<BackendStatus>): Unsubscribe {
    return this.statusEvents.on(handler);
  }

  private setConnection(connection: ConnectionState, patch: Partial<BackendStatus> = {}) {
    this.status = { ...this.status, connection, ...patch };
    this.statusEvents.emit(this.status);
  }

  // ---- pairing ----
  async startPairing(opts: { method: 'qr' | 'code'; phoneE164?: string }): Promise<void> {
    this.clearTimers();
    this.setConnection('connecting', { last_error: null });

    if (opts.method === 'code') {
      // WhatsApp shows an 8-char pairing code grouped 4+4.
      this.after(600, () => this.pairingEvents.emit({ kind: 'code', code: 'WMCP-7Q3X' }));
    } else {
      // QR rotates roughly every 20s on real WhatsApp; fake a couple of rounds.
      let round = 0;
      const emitQr = () =>
        this.pairingEvents.emit({
          kind: 'qr',
          payload: `mock-qr-payload-${round++}-${'x'.repeat(64)}`,
        });
      this.after(400, emitQr);
      const interval = setInterval(emitQr, 20_000);
      this.timers.add(interval);
    }

    // Either way, simulate the phone confirming the link after a few seconds.
    this.after(4000, () => {
      this.pairingEvents.emit({ kind: 'success', account: MOCK_ACCOUNT });
      this.setConnection('syncing', { paired_account: MOCK_ACCOUNT });
      this.runInitialSync();
    });
  }

  onPairingEvent(handler: Handler<PairingEvent>): Unsubscribe {
    return this.pairingEvents.on(handler);
  }

  async cancelPairing(): Promise<void> {
    this.clearTimers();
    if (this.status.connection === 'connecting') {
      this.setConnection('unpaired');
    }
  }

  async unlinkDevice(): Promise<void> {
    this.clearTimers();
    this.status = {
      connection: 'unpaired',
      paired_account: null,
      last_sync_at: null,
      last_error: null,
      store_chat_count: 0,
      store_message_count: 0,
    };
    this.statusEvents.emit(this.status);
  }

  // ---- sync ----
  async syncNow(): Promise<void> {
    if (!this.status.paired_account) return;
    this.setConnection('syncing');
    this.runIncrementalSync();
  }

  async reclaimConnection(): Promise<{
    reclaimed: boolean;
    reason?: 'claude_active';
  }> {
    this.setConnection('syncing');
    this.runIncrementalSync();
    return { reclaimed: true };
  }

  onSyncProgress(handler: Handler<SyncProgress>): Unsubscribe {
    return this.syncEvents.on(handler);
  }

  private runInitialSync() {
    this.rampSync('initial', 0, 0, TARGET_CHATS, TARGET_MESSAGES, () => {
      this.setConnection('connected', {
        last_sync_at: nowSeconds(),
        store_chat_count: TARGET_CHATS,
        store_message_count: TARGET_MESSAGES,
      });
    });
  }

  private runIncrementalSync() {
    const startChats = this.status.store_chat_count;
    const startMsgs = this.status.store_message_count;
    this.rampSync(
      'incremental',
      startChats,
      startMsgs,
      startChats + 2,
      startMsgs + 23,
      () => {
        this.setConnection('connected', {
          last_sync_at: nowSeconds(),
          store_chat_count: startChats + 2,
          store_message_count: startMsgs + 23,
        });
      },
    );
  }

  private rampSync(
    phase: SyncProgress['phase'],
    fromChats: number,
    fromMsgs: number,
    toChats: number,
    toMsgs: number,
    done: () => void,
  ) {
    const steps = 24;
    let step = 0;
    const tick = () => {
      step++;
      const t = step / steps;
      const chats = Math.round(fromChats + (toChats - fromChats) * t);
      const messages = Math.round(fromMsgs + (toMsgs - fromMsgs) * t);
      const initial_complete = step >= steps;
      this.syncEvents.emit({ phase, chats_synced: chats, messages_synced: messages, initial_complete });
      this.status = { ...this.status, store_chat_count: chats, store_message_count: messages };
      if (initial_complete) done();
      else this.after(120, tick);
    };
    this.after(120, tick);
  }

  // ---- config ----
  async getConfig(): Promise<UserConfig> {
    return this.config;
  }
  async setConfig(patch: Partial<UserConfig>): Promise<UserConfig> {
    this.config = {
      ...this.config,
      ...patch,
      enabled_tools: { ...this.config.enabled_tools, ...(patch.enabled_tools ?? {}) },
    };
    return this.config;
  }

  // ---- claude desktop ----
  async configureClaudeDesktop(): Promise<{ patched: boolean; configPath: string }> {
    return {
      patched: true,
      configPath:
        '~/Library/Application Support/Claude/claude_desktop_config.json (mock)',
    };
  }

  // ---- helpers ----
  private after(ms: number, fn: () => void) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
  }
  private clearTimers() {
    for (const t of this.timers) clearTimeout(t as NodeJS.Timeout);
    this.timers.clear();
  }
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}
