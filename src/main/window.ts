// GUI entry: creates the BrowserWindow, instantiates the backend controller,
// and bridges renderer <-> controller over IPC. Invoke channels map 1:1 to
// controller methods; controller events are forwarded to the renderer as
// pushes. Called from src/main/index.ts when launched without --mcp.

import { app, BrowserWindow, ipcMain, net, protocol, shell } from 'electron';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { BackendController } from '../types/ipc';
import { IPC, type AppInfo } from '../shared/bridge';
import { checkForUpdate } from './updates';

const RENDERER_ROOT = path.join(__dirname, '..', 'renderer');

/**
 * Serve the built renderer from app://bundle/* (the scheme is registered as
 * privileged in index.ts, before app-ready). file:// would give the page an
 * opaque origin that a `script-src 'self'` CSP refuses to load the bundle from;
 * a standard+secure scheme gives a real origin (app://bundle) that 'self'
 * matches — and it's how the packaged DMG serves the UI too. Requests are
 * mapped to files under dist/renderer, confined to RENDERER_ROOT.
 */
let appProtocolRegistered = false;
function registerAppProtocol(): void {
  if (appProtocolRegistered) return;
  appProtocolRegistered = true;
  protocol.handle('app', (request) => {
    const { pathname } = new URL(request.url);
    const rel =
      pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
    const resolved = path.join(RENDERER_ROOT, rel);
    // Guard against path traversal escaping the renderer root.
    if (resolved !== RENDERER_ROOT && !resolved.startsWith(RENDERER_ROOT + path.sep)) {
      return new Response('Not found', { status: 404 });
    }
    return net.fetch(pathToFileURL(resolved).toString());
  });
}

// Default to the real backend; set USE_MOCK_BACKEND=true to drive the UI from
// the mock (useful when iterating on renderer changes without a paired phone).
const USE_MOCK = process.env.USE_MOCK_BACKEND === 'true';

async function createController(): Promise<BackendController> {
  if (USE_MOCK) {
    const { MockBackendController } = await import('./__mock__/backend');
    return new MockBackendController();
  }
  const { createBackendController } = await import('../backend');
  return createBackendController();
}

function appInfo(): AppInfo {
  return { version: app.getVersion(), platform: process.platform, mock: USE_MOCK };
}

export async function runGuiApp(): Promise<void> {
  registerAppProtocol();

  const controller = await createController();
  await controller.start();

  const win = new BrowserWindow({
    width: 460,
    height: 620,
    minWidth: 420,
    minHeight: 520,
    resizable: true,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0b141a',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // sandbox disabled so the preload can require the local ./shared/bridge
      // module (constants only). A sandboxed preload may only require electron +
      // node builtins. contextIsolation stays on, so the renderer still never
      // touches Node or ipcRenderer directly.
      sandbox: false,
      // Keep rendering when the window is occluded/backgrounded so the live
      // status + sync counts don't freeze behind other windows.
      backgroundThrottling: false,
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
  ipcMain.handle(IPC.reclaimConnection, () => controller.reclaimConnection());
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
    await win.loadURL('app://bundle/index.html');
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void runGuiApp();
  });
}
