import { app, protocol } from 'electron';

const isMcpMode = process.argv.includes('--mcp');

if (isMcpMode) {
  app.on('window-all-closed', () => {});
  app.whenReady().then(async () => {
    const { runMcpServer } = await import('../mcp/server');
    await runMcpServer();
    app.quit();
  });
} else {
  // The renderer is served over a custom privileged scheme (app://) instead of
  // file://. file:// gives the page an opaque origin, so a `script-src 'self'`
  // CSP refuses to load the bundled JS (and that's how the packaged DMG runs).
  // A standard+secure scheme gives a real origin (app://bundle) that 'self'
  // matches. Must be registered before app-ready — hence this lives here in the
  // GUI bootstrap rather than in window.ts (which is imported post-ready).
  // GUI-only change to a shared entry point; flagged for the backend agent.
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
    const { runGuiApp } = await import('./window');
    await runGuiApp();
  });
}
