// GUI bridge contract — the glue between the Electron main process and the
// renderer. Owned by the GUI agent. Contains only IPC channel names and the
// shape of the API exposed on `window.whatsapp` (see src/preload.ts). No
// runtime side effects, so it is safe to import from both the main process
// (compiled by tsc) and the renderer bundle (built by Vite).

import type {
  BackendStatus,
  PairingEvent,
  SyncProgress,
  UserConfig,
  Unsubscribe,
} from '../types/ipc';

export type { BackendStatus, PairingEvent, SyncProgress, UserConfig, Unsubscribe };

/** App metadata surfaced to the renderer. */
export interface AppInfo {
  version: string;
  platform: NodeJS.Platform;
  /** True when running against the mock backend (no real WhatsApp socket). */
  mock: boolean;
}

/** Result of the notify-only GitHub Releases poll. */
export interface UpdateInfo {
  current: string;
  latest: string;
  isNewer: boolean;
  url: string;
}

/** The API object exposed on `window.whatsapp` by the preload script. */
export interface WhatsAppBridge {
  // App / meta
  getAppInfo(): Promise<AppInfo>;
  checkForUpdate(): Promise<UpdateInfo | null>;
  openExternal(url: string): Promise<void>;

  // Status
  getStatus(): Promise<BackendStatus>;
  onStatusChange(cb: (status: BackendStatus) => void): Unsubscribe;

  // Pairing
  startPairing(opts: { method: 'qr' | 'code'; phoneE164?: string }): Promise<void>;
  cancelPairing(): Promise<void>;
  unlinkDevice(): Promise<void>;
  onPairingEvent(cb: (event: PairingEvent) => void): Unsubscribe;

  // Sync
  syncNow(): Promise<void>;
  onSyncProgress(cb: (progress: SyncProgress) => void): Unsubscribe;

  // Config (per-tool toggles)
  getConfig(): Promise<UserConfig>;
  setConfig(patch: Partial<UserConfig>): Promise<UserConfig>;

  // Claude Desktop integration
  configureClaudeDesktop(): Promise<{ patched: boolean; configPath: string }>;
}

/** IPC channel names. `invoke:*` are request/response; `event:*` are pushes. */
export const IPC = {
  // invoke (renderer -> main)
  getAppInfo: 'app:getInfo',
  checkForUpdate: 'app:checkForUpdate',
  openExternal: 'app:openExternal',
  getStatus: 'backend:getStatus',
  startPairing: 'backend:startPairing',
  cancelPairing: 'backend:cancelPairing',
  unlinkDevice: 'backend:unlinkDevice',
  syncNow: 'backend:syncNow',
  getConfig: 'backend:getConfig',
  setConfig: 'backend:setConfig',
  configureClaudeDesktop: 'backend:configureClaudeDesktop',

  // events (main -> renderer)
  evtStatus: 'event:status',
  evtPairing: 'event:pairing',
  evtSync: 'event:sync',
} as const;

declare global {
  interface Window {
    whatsapp: WhatsAppBridge;
  }
}
