import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// Renderer-only Vite config. The Electron main process and preload are
// compiled separately by `tsc` (see tsconfig.json) — this only bundles the
// React UI under src/renderer into dist/renderer.
//
// `base: './'` makes asset URLs relative so the built index.html loads over
// the file:// protocol inside the packaged .app.
export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
  },
});
