// Shared types for tool handlers. Each tool file exports a ToolHandler; the
// dispatcher in server.ts passes it the live context and validated args.

import type { Store } from '../store';
import type { WhatsAppConnection } from '../baileys';

export interface ToolContext {
  store: Store;
  connection: WhatsAppConnection;
}

/** MCP content blocks we produce. Mirrors the SDK's CallToolResult content. */
export type ToolContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'audio'; data: string; mimeType: string }
  | {
      type: 'resource';
      resource: { uri: string; mimeType?: string; blob: string };
    };

export interface ToolResult {
  content: ToolContent[];
  isError?: boolean;
}

export type ToolHandler = (
  ctx: ToolContext,
  args: Record<string, unknown>,
) => Promise<ToolResult>;

/** Wrap any JSON-serialisable value as a single text content block. */
export function json(value: unknown): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  };
}

export function textError(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

// ---- small arg coercion helpers (clients don't always apply schema defaults) ----

export function intArg(
  args: Record<string, unknown>,
  key: string,
  def: number,
  min?: number,
  max?: number,
): number {
  const raw = args[key];
  let n = typeof raw === 'number' ? Math.floor(raw) : def;
  if (!Number.isFinite(n)) n = def;
  if (min != null) n = Math.max(min, n);
  if (max != null) n = Math.min(max, n);
  return n;
}

export function strArg(
  args: Record<string, unknown>,
  key: string,
): string | undefined {
  const raw = args[key];
  return typeof raw === 'string' ? raw : undefined;
}

export function requireStr(
  args: Record<string, unknown>,
  key: string,
): string {
  const v = strArg(args, key);
  if (v == null || v === '') throw new Error(`Missing required argument: ${key}`);
  return v;
}

export function boolArg(
  args: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const raw = args[key];
  return typeof raw === 'boolean' ? raw : undefined;
}
