// Conditional postinstall: rebuild native modules against Electron's ABI only
// on macOS (the DMG target). On Linux (the Pi / headless CLI path), Electron
// will never run — so a rebuild for Electron's ABI just breaks plain `node`
// loading of better-sqlite3 (the daemon crashes with NODE_MODULE_VERSION mismatch).
//
// Force the Electron rebuild on Linux only if you're actively developing the
// GUI there: `WHATSAPP_MCP_FORCE_ELECTRON_REBUILD=1 npm install`, or run
// `electron-builder install-app-deps` by hand.

'use strict';

const { execSync } = require('node:child_process');

const force = process.env.WHATSAPP_MCP_FORCE_ELECTRON_REBUILD === '1';

if (process.platform === 'linux' && !force) {
  console.log(
    'postinstall: skipping electron-builder install-app-deps on Linux ' +
      '(set WHATSAPP_MCP_FORCE_ELECTRON_REBUILD=1 to override)',
  );
  process.exit(0);
}

execSync('electron-builder install-app-deps', { stdio: 'inherit' });
