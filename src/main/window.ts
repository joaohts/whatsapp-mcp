// GUI entry: creates the BrowserWindow, instantiates the backend controller,
// and bridges renderer <-> controller over IPC. Invoke channels map 1:1 to
// controller methods; controller events are forwarded to the renderer as
// pushes. Called from src/main/index.ts when launched without --mcp.

import { app, BrowserWindow, ipcMain, shell } from 'electron';
import * as path from 'node:path';
import type { BackendController } from '../types/ipc';
import { IPC, type AppInfo } from '../shared/bridge';
import { checkForUpdate } from './updates';

// While the real backend (src/backend/controller.ts) is incomplete, drive the
// UI from the mock. Set USE_MOCK_BACKEND=false once the real one lands and is
// wired in below.
const USE_MOCK = process.env.USE_MOCK_BACKEND !== 'false';

async function createController(): Promise<BackendController> {
  if (USE_MOCK) {
    const { MockBackendController } = await import('./__mock__/backend');
    return new MockBackendController();
  }
  // TODO(backend): swap in the real controller when it exists.
  //   const { createBackendController } = await import('../backend/controller');
  //   return createBackendController();
  const { MockBackendController } = await import('./__mock__/backend');
  return new MockBackendController();
}

function appInfo(): AppInfo {
  return { version: app.getVersion(), platform: process.platform, mock: USE_MOCK };
}

export async function runGuiApp(): Promise<void> {
  const controller = await createController();
  await controller.start();

  const win = new BrowserWindow({
    width: 460,
    height: 720,
    minWidth: 420,
    minHeight: 600,
    resizable: true,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0b141a',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.once('ready-to-show', () => win.show());

  // Forward controller events to the renderer.
  const send = (channel: string, payload: unknown) => {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  };
  const unsubscribers = [
    controller.onStatusChange((s) => send(IPC.evtStatus, s)),
    controller.onPairingEvent((e) => send(IPC.evtPairing, e)),
    controller.onSyncProgress((p) => send(IPC.evtSync, p)),
  ];

  // App / meta.
  ipcMain.handle(IPC.getAppInfo, () => appInfo());
  ipcMain.handle(IPC.checkForUpdate, () => checkForUpdate(app.getVersion()));
  ipcMain.handle(IPC.openExternal, (_e, url: string) => shell.openExternal(url));

  // Backend controller method bridge.
  ipcMain.handle(IPC.getStatus, () => controller.getStatus());
  ipcMain.handle(IPC.startPairing, (_e, opts) => controller.startPairing(opts));
  ipcMain.handle(IPC.cancelPairing, () => controller.cancelPairing());
  ipcMain.handle(IPC.unlinkDevice, () => controller.unlinkDevice());
  ipcMain.handle(IPC.syncNow, () => controller.syncNow());
  ipcMain.handle(IPC.getConfig, () => controller.getConfig());
  ipcMain.handle(IPC.setConfig, (_e, patch) => controller.setConfig(patch));
  ipcMain.handle(IPC.configureClaudeDesktop, () => controller.configureClaudeDesktop());

  win.on('closed', () => {
    for (const off of unsubscribers) off();
  });

  app.on('before-quit', () => {
    void controller.stop();
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    await win.loadURL(devServerUrl);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void runGuiApp();
  });
}
