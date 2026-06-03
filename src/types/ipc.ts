// Contract between Electron main process (GUI side) and the backend
// controller. The GUI module calls these methods via Electron IPC;
// the backend module implements them.

import type { ToolName } from './tools';

export interface BackendController {
  // Lifecycle
  start(): Promise<void>;
  stop(): Promise<void>;

  // Connection / status
  getStatus(): Promise<BackendStatus>;
  onStatusChange(handler: (status: BackendStatus) => void): Unsubscribe;

  // Pairing
  startPairing(opts: { method: 'qr' | 'code'; phoneE164?: string }): Promise<void>;
  onPairingEvent(handler: (event: PairingEvent) => void): Unsubscribe;
  cancelPairing(): Promise<void>;
  unlinkDevice(): Promise<void>;

  // Sync
  syncNow(): Promise<void>;
  onSyncProgress(handler: (progress: SyncProgress) => void): Unsubscribe;

  /** GUI-only: reclaim the Baileys socket from the --mcp subprocess if it's
   *  not alive. Refuses (returns reclaimed:false) when Claude is open. */
  reclaimConnection(): Promise<{ reclaimed: boolean; reason?: 'claude_active' }>;

  // Config (per-tool toggles)
  getConfig(): Promise<UserConfig>;
  setConfig(patch: Partial<UserConfig>): Promise<UserConfig>;

  // Claude Desktop integration
  configureClaudeDesktop(): Promise<{ patched: boolean; configPath: string }>;
}

export type Unsubscribe = () => void;

export type ConnectionState =
  | 'unpaired'
  | 'connecting'
  | 'syncing'
  | 'connected'
  | 'disconnected'
  /** Another session (the GUI or the MCP subprocess sibling) owns the
   *  Baileys socket. Not an error — Model C says yield without fighting. */
  | 'in_use_elsewhere'
  | 'error';

export interface BackendStatus {
  connection: ConnectionState;
  paired_account: { name: string; number: string } | null;
  last_sync_at: number | null;
  last_error: string | null;
  store_chat_count: number;
  store_message_count: number;
}

export type PairingEvent =
  | { kind: 'qr'; payload: string }
  | { kind: 'code'; code: string }
  | { kind: 'success'; account: { name: string; number: string } }
  | { kind: 'error'; message: string };

export interface SyncProgress {
  phase: 'initial' | 'incremental';
  chats_synced: number;
  messages_synced: number;
  /** True when the initial post-pair history sync has finished. */
  initial_complete: boolean;
}

export interface UserConfig {
  enabled_tools: Record<ToolName, boolean>;
}
