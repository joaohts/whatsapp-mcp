// MCP server entry (--mcp mode). Opens the store, brings up the read-only
// WhatsApp connection, and serves tool calls over stdio. stdout is reserved
// for the JSON-RPC transport, so we (a) log only to file and (b) defensively
// redirect console.* away from stdout.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { TOOLS, SERVER_INSTRUCTIONS_UNTRUSTED, type ToolName } from '../types/tools';
import { Store } from '../store';
import { WhatsAppConnection } from '../baileys';
import { ensureAppDirs, storeDbPath, mcpLogPath, mcpPidPath } from '../backend/paths';
import { writeFileSync, unlinkSync } from 'fs';
import { configureLogger, log } from '../backend/logger';
import { loadConfig } from '../backend/config';
import { HANDLERS } from './tools';
import { textError, type ToolContext } from './context';

const APP_VERSION = '0.0.1';

export async function runMcpServer(): Promise<void> {
  redirectConsoleToLog();
  ensureAppDirs();
  configureLogger({ file: mcpLogPath, level: 'info' });
  log.info('--- MCP server starting ---');

  // PID file so the GUI can detect that an MCP subprocess is alive and avoid
  // reclaiming the Baileys socket while Claude is using it. Cleared on
  // every exit path we can hook; the GUI also tests kill(pid, 0) to handle
  // crashes that left a stale file.
  writeFileSync(mcpPidPath, String(process.pid));
  const cleanupPid = (): void => {
    try {
      unlinkSync(mcpPidPath);
    } catch {
      // Already gone — fine.
    }
  };
  process.on('exit', cleanupPid);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(sig, () => {
      cleanupPid();
      process.exit(0);
    });
  }

  const config = loadConfig();
  const enabled = new Set<ToolName>(
    (Object.keys(config.enabled_tools) as ToolName[]).filter(
      (t) => config.enabled_tools[t],
    ),
  );

  const store = new Store(storeDbPath);
  const connection = new WhatsAppConnection(store);
  const ctx: ToolContext = { store, connection };

  // Bring up the socket with existing auth. If unpaired this still resolves;
  // store-only tools work (returning whatever is cached), socket-dependent
  // tools report "not connected".
  connection.start().catch((err) => log.error('connection.start failed', err));

  const server = new Server(
    { name: 'whatsapp', version: APP_VERSION },
    {
      capabilities: { tools: {} },
      // Per-session prompt-injection posture note. Folded into the client's
      // system prompt during the initialize handshake; covers every tool in
      // this server so individual tool descriptions stay clean.
      instructions: SERVER_INSTRUCTIONS_UNTRUSTED,
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.filter((t) => enabled.has(t.name)).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema as unknown as Record<string, unknown>,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name as ToolName;
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;

    if (!enabled.has(name) || !HANDLERS[name]) {
      return textError(`Unknown or disabled tool: ${name}`);
    }

    // Per PLANNING: the initial post-pair history sync blocks tool responses
    // so Claude's first call sees a populated store. No-op once resolved.
    await connection.waitForInitialSync();

    try {
      return await HANDLERS[name](ctx, args);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`tool ${name} failed`, err);
      return textError(`Tool ${name} failed: ${message}`);
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info(`MCP server connected. ${enabled.size} tools exposed.`);

  await installShutdown(async () => {
    log.info('shutting down');
    try {
      await connection.stop();
    } catch (err) {
      log.warn('connection.stop error', err);
    }
    try {
      store.close();
    } catch (err) {
      log.warn('store.close error', err);
    }
  });
}

/**
 * Keep the process alive until the transport closes (stdin EOF) or a signal,
 * then run cleanup. Resolves so the caller can exit.
 */
function installShutdown(cleanup: () => Promise<void>): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = async () => {
      if (done) return;
      done = true;
      await cleanup();
      resolve();
    };
    process.on('SIGTERM', finish);
    process.on('SIGINT', finish);
    process.stdin.on('close', finish);
    process.stdin.on('end', finish);
  });
}

/** Stop stray console output from corrupting the JSON-RPC stream on stdout. */
function redirectConsoleToLog(): void {
  console.log = (...a: unknown[]) => log.info(...a);
  console.info = (...a: unknown[]) => log.info(...a);
  console.warn = (...a: unknown[]) => log.warn(...a);
  console.error = (...a: unknown[]) => log.error(...a);
  console.debug = (...a: unknown[]) => log.debug(...a);
}
