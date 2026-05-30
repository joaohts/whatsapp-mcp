// Dual-mode entry point.
//   no args  -> Electron GUI (pairing, status, settings, configure Claude)
//   --mcp    -> MCP server over stdio
//
// NOTE for the GUI agent: the --mcp path is intentionally Electron-free. The
// MCP server is headless — it never opens a window and does not need the app
// lifecycle — so it runs identically whether launched by the packaged Electron
// binary (production) or `node dist/main/index.js --mcp` (dev/CI testing).
// The GUI branch loads ../main/window through a string indirection so this
// router does not compile-depend on window.ts (your lane).

const isMcpMode = process.argv.includes('--mcp');

if (isMcpMode) {
  void import('../mcp/server').then(({ runMcpServer }) => runMcpServer());
} else {
  const { app } = require('electron') as typeof import('electron');
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
