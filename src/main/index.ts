import { app } from 'electron';

const isMcpMode = process.argv.includes('--mcp');

if (isMcpMode) {
  app.on('window-all-closed', () => {});
  app.whenReady().then(async () => {
    const { runMcpServer } = await import('../mcp/server');
    await runMcpServer();
    app.quit();
  });
} else {
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.whenReady().then(async () => {
    const { runGuiApp } = await import('./window');
    await runGuiApp();
  });
}
