// The MCP SDK is ESM with an exports map; its subpaths resolve correctly at
// runtime (Node honours the exports `require` condition -> dist/cjs). Our
// tsconfig uses classic "node" resolution, which consults the exports map but
// can't follow it to the right .d.ts here, so TS sees the subpaths as untyped.
//
// Rather than migrate the whole project to node16 resolution (which introduces
// CJS/ESM interop friction), we declare the minimal surface we actually use.
// Kept intentionally small; widen if we adopt more of the SDK.

declare module '@modelcontextprotocol/sdk/server/index.js' {
  export interface ServerInfo {
    name: string;
    version: string;
  }
  export interface ServerOptions {
    capabilities: Record<string, unknown>;
    /**
     * Server-level instructions sent in the initialize response. The MCP
     * client folds these into its system prompt for the session. Used here
     * for the prompt-injection posture note covering untrusted message
     * content; see SERVER_INSTRUCTIONS_UNTRUSTED in src/types/tools.ts.
     */
    instructions?: string;
  }
  export class Server {
    constructor(info: ServerInfo, options: ServerOptions);
    setRequestHandler(
      schema: unknown,
      handler: (
        request: {
          params: { name?: string; arguments?: Record<string, unknown> };
        },
        extra: unknown,
      ) => unknown | Promise<unknown>,
    ): void;
    connect(transport: unknown): Promise<void>;
    close(): Promise<void>;
  }
}

declare module '@modelcontextprotocol/sdk/server/stdio.js' {
  export class StdioServerTransport {
    constructor();
  }
}

declare module '@modelcontextprotocol/sdk/types.js' {
  export const CallToolRequestSchema: unknown;
  export const ListToolsRequestSchema: unknown;
}
