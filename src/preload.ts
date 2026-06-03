// Preload: runs in an isolated context with access to a limited Node surface
// and bridges the renderer to the main process over IPC. The renderer only
// ever sees the `window.whatsapp` object defined here — never ipcRenderer
// directly (contextIsolation is on).

import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type WhatsAppBridge } from './shared/bridge';

/** Subscribe to a main->renderer event channel; returns an unsubscribe fn. */
function subscribe<T>(channel: string, cb: (payload: T) => void) {
  const listener = (_event: Electron.IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const bridge: WhatsAppBridge = {
  // App / meta
  getAppInfo: () => ipcRenderer.invoke(IPC.getAppInfo),
  checkForUpdate: () => ipcRenderer.invoke(IPC.checkForUpdate),
  openExternal: (url) => ipcRenderer.invoke(IPC.openExternal, url),

  // Status
  getStatus: () => ipcRenderer.invoke(IPC.getStatus),
  onStatusChange: (cb) => subscribe(IPC.evtStatus, cb),

  // Pairing
  startPairing: (opts) => ipcRenderer.invoke(IPC.startPairing, opts),
  cancelPairing: () => ipcRenderer.invoke(IPC.cancelPairing),
  unlinkDevice: () => ipcRenderer.invoke(IPC.unlinkDevice),
  onPairingEvent: (cb) => subscribe(IPC.evtPairing, cb),

  // Sync
  syncNow: () => ipcRenderer.invoke(IPC.syncNow),
  onSyncProgress: (cb) => subscribe(IPC.evtSync, cb),

  // Config
  getConfig: () => ipcRenderer.invoke(IPC.getConfig),
  setConfig: (patch) => ipcRenderer.invoke(IPC.setConfig, patch),

  // Claude Desktop
  configureClaudeDesktop: () => ipcRenderer.invoke(IPC.configureClaudeDesktop),
};

contextBridge.exposeInMainWorld('whatsapp', bridge);
