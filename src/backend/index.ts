// Public surface for the GUI agent: construct a BackendController and bridge
// its methods over Electron IPC to the renderer.
export {
  BackendControllerImpl,
  createBackendController,
} from './controller';
export { configureClaudeDesktop } from './claude-config';
export { loadConfig, saveConfig, patchConfig, defaultConfig } from './config';
export * from './paths';
