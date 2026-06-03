// File logger. In --mcp mode stdout is the JSON-RPC transport, so NOTHING may
// ever be written to stdout/stderr — every diagnostic goes to the log file.
// Also exposes a pino-compatible shim so Baileys can log through us without
// pulling pino in as a direct dependency.

import { appendFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { mcpLogPath } from './paths';

type Level = 'trace' | 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<Level, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
};

let minLevel: Level = 'info';
let logFile = mcpLogPath;
let ready = false;

function ensureFile(): void {
  if (ready) return;
  try {
    mkdirSync(dirname(logFile), { recursive: true });
    ready = true;
  } catch {
    // If we cannot create the log dir there is nowhere safe to report it
    // (stdout is reserved). Swallow and carry on.
  }
}

export function configureLogger(opts: { level?: Level; file?: string }): void {
  if (opts.level) minLevel = opts.level;
  if (opts.file) {
    logFile = opts.file;
    ready = false;
  }
}

function write(level: Level, args: unknown[]): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;
  ensureFile();
  const ts = new Date().toISOString();
  const parts = args.map((a) =>
    typeof a === 'string' ? a : safeStringify(a),
  );
  const line = `${ts} ${level.toUpperCase().padEnd(5)} ${parts.join(' ')}\n`;
  try {
    appendFileSync(logFile, line);
  } catch {
    // see ensureFile()
  }
}

function safeStringify(value: unknown): string {
  try {
    if (value instanceof Error) {
      return `${value.name}: ${value.message}\n${value.stack ?? ''}`;
    }
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export const log = {
  trace: (...args: unknown[]) => write('trace', args),
  debug: (...args: unknown[]) => write('debug', args),
  info: (...args: unknown[]) => write('info', args),
  warn: (...args: unknown[]) => write('warn', args),
  error: (...args: unknown[]) => write('error', args),
};

// ---- Baileys (pino-like) logger shim -------------------------------------
// Baileys calls logger.{trace,debug,info,warn,error}(obj, msg?) and
// logger.child(bindings). It also reads/writes `.level`. We map all of that
// onto the file logger above.

export interface PinoLike {
  level: string;
  trace: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  child: (bindings: Record<string, unknown>) => PinoLike;
}

export function makeBaileysLogger(level: Level = 'warn'): PinoLike {
  const make = (prefix: string): PinoLike => ({
    level,
    trace: (...a) => write('trace', prefix ? [prefix, ...a] : a),
    debug: (...a) => write('debug', prefix ? [prefix, ...a] : a),
    info: (...a) => write('info', prefix ? [prefix, ...a] : a),
    warn: (...a) => write('warn', prefix ? [prefix, ...a] : a),
    error: (...a) => write('error', prefix ? [prefix, ...a] : a),
    child: (bindings) =>
      make(`${prefix}${JSON.stringify(bindings)} `),
  });
  return make('');
}
