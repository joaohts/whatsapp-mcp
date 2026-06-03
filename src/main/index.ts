// Dual-mode entry point.
//   no args  -> Electron GUI (pairing, status, settings, configure Claude)
//   --mcp    -> MCP server over stdio
//
// The --mcp path is intentionally Electron-free: no top-level electron import,
// so `node dist/main/index.js --mcp` works for dev/CI testing without the
// packaged Electron runtime. window.ts is loaded via string indirection so the
// router does not compile-depend on it.

const isMcpMode = process.argv.includes('--mcp');

if (isMcpMode) {
  void import('../mcp/server').then(({ runMcpServer }) => runMcpServer());
} else {
  const { app, protocol } = require('electron') as typeof import('electron');

  // The renderer is served over a custom privileged scheme (app://) instead of
  // file://. file:// gives the page an opaque origin, so a `script-src 'self'`
  // CSP refuses to load the bundled JS (and that's how the packaged DMG runs).
  // A standard+secure scheme gives a real origin (app://bundle) that 'self'
  // matches. Must be registered before app-ready.
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'app',
      privileges: { standard: true, secure: true, supportFetchAPI: true },
    },
  ]);

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.whenReady().then(async () => {
    const windowModule = '../main/window';
    const { runGuiApp } = (await import(windowModule)) as {
      runGuiApp: () => Promise<void>;
    };
    await runGuiApp();
  });
}
