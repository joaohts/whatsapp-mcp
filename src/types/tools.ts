// MCP tool definitions — the contract between backend implementation
// and GUI settings panel. Both modules read from TOOLS; nothing else
// defines the tool surface.

export type ToolCategory = 'chats' | 'media' | 'contacts';

export interface ToolDef {
  name: string;
  description: string;
  category: ToolCategory;
  enabledByDefault: boolean;
  inputSchema: JsonSchema;
}

export type JsonSchema = {
  type: 'object';
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
  additionalProperties?: false;
};

export type JsonSchemaProperty =
  | { type: 'string'; description?: string; enum?: readonly string[] }
  | {
      type: 'number' | 'integer';
      description?: string;
      minimum?: number;
      maximum?: number;
      default?: number;
    }
  | { type: 'boolean'; description?: string; default?: boolean };

export const TOOLS = [
  // ---- Chats & messages ----
  {
    name: 'list_chats',
    description: 'List chats from the local store, most recent first.',
    category: 'chats',
    enabledByDefault: true,
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 500, default: 50 },
        offset: { type: 'integer', minimum: 0, default: 0 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'chats_overview',
    description:
      'List chats with summary info (last message, unread count). Most recent first.',
    category: 'chats',
    enabledByDefault: true,
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 500, default: 50 },
        offset: { type: 'integer', minimum: 0, default: 0 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_chat_messages',
    description:
      'Read messages from a chat (text + metadata). Use chat_id from list_chats. Most recent first.',
    category: 'chats',
    enabledByDefault: true,
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: {
          type: 'string',
          description: 'Chat ID (e.g. 5511...@c.us or ...@g.us)',
        },
        limit: { type: 'integer', minimum: 1, maximum: 500, default: 50 },
        before_timestamp: {
          type: 'integer',
          description: 'Unix seconds; messages older than this.',
        },
        after_timestamp: {
          type: 'integer',
          description: 'Unix seconds; messages newer than this.',
        },
        from_me: {
          type: 'boolean',
          description: 'Filter by whether the user sent the message.',
        },
      },
      required: ['chat_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_message',
    description: 'Fetch a single message by chat_id + message_id.',
    category: 'chats',
    enabledByDefault: true,
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string' },
        message_id: { type: 'string' },
      },
      required: ['chat_id', 'message_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'unread_summary',
    description:
      'Summary of chats with unread messages and counts. No message bodies.',
    category: 'chats',
    enabledByDefault: true,
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'search_messages',
    description:
      'Search message bodies via local full-text search. Returns chat_id + message excerpts.',
    category: 'chats',
    enabledByDefault: true,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        max_chats: { type: 'integer', minimum: 1, maximum: 500, default: 50 },
        limit_per_chat: {
          type: 'integer',
          minimum: 1,
          maximum: 100,
          default: 10,
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'fetch_more_history',
    description:
      'Pull older messages for a chat from WhatsApp and persist to the local store. Use when get_chat_messages does not reach far enough back. Returns {fetched_count, oldest_in_store_timestamp}.',
    category: 'chats',
    enabledByDefault: true,
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string' },
        before_timestamp: {
          type: 'integer',
          description:
            'Anchor; fetches messages older than this. Defaults to the oldest in store.',
        },
        count: { type: 'integer', minimum: 1, maximum: 500, default: 50 },
      },
      required: ['chat_id'],
      additionalProperties: false,
    },
  },

  // ---- Media ----
  {
    name: 'list_chat_media',
    description:
      'Index of media items in a chat (id, timestamp, mime, filename, caption) without downloading bodies.',
    category: 'media',
    enabledByDefault: true,
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string' },
        type: {
          type: 'string',
          enum: ['image', 'video', 'audio', 'document', 'sticker'] as const,
        },
        limit: { type: 'integer', minimum: 1, maximum: 500, default: 50 },
        offset: { type: 'integer', minimum: 0, default: 0 },
      },
      required: ['chat_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'download_media',
    description:
      'Download a media item (audio/image/video/document) and return its bytes inline as MCP content.',
    category: 'media',
    enabledByDefault: true,
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string' },
        message_id: { type: 'string' },
      },
      required: ['chat_id', 'message_id'],
      additionalProperties: false,
    },
  },

  // ---- Contacts & groups ----
  {
    name: 'list_contacts',
    description: 'List all known contacts from the local store.',
    category: 'contacts',
    enabledByDefault: true,
    inputSchema: {
      type: 'object',
      properties: {
        refresh: {
          type: 'boolean',
          description: 'If true, refresh from Baileys before returning.',
          default: false,
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'search_contacts',
    description: 'Substring-search contacts by name, push name, or phone number.',
    category: 'contacts',
    enabledByDefault: true,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 500, default: 50 },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_contact',
    description:
      'Get contact or group info by chat_id. Polymorphic: returns direct-contact fields for @c.us IDs, group fields (subject, participants, admins) for @g.us IDs.',
    category: 'contacts',
    enabledByDefault: true,
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string' },
      },
      required: ['chat_id'],
      additionalProperties: false,
    },
  },
] as const satisfies readonly ToolDef[];

export type ToolName = (typeof TOOLS)[number]['name'];
