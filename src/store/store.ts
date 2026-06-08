// Typed SQLite store. The Baileys layer writes through the upsert* methods;
// the MCP tools read through the query methods. Nothing else touches the DB.

import Database from 'better-sqlite3';
import type { Database as DB } from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { migrate } from './schema';
import type {
  Chat,
  ChatOverview,
  ChatId,
  ContactInfo,
  MediaIndexEntry,
  Message,
  MessageId,
  MessageType,
  Reaction,
  UnreadChatSummary,
} from '../types/messages';

export interface ChatUpsert {
  id: ChatId;
  name?: string | null;
  is_group?: boolean;
  is_muted?: boolean;
  unread_count?: number | null;
  last_message_timestamp?: number | null;
  last_message_preview?: string | null;
  last_message_from_me?: boolean | null;
}

export interface MessageUpsert {
  id: MessageId;
  chat_id: ChatId;
  timestamp: number;
  sender_id?: ChatId | null;
  from_me: boolean;
  author?: ChatId | null;
  body?: string | null;
  type: MessageType;
  has_media?: boolean;
  reply_to_message_id?: MessageId | null;
  edited_at?: number | null;
  read_by_recipient?: boolean | null;
  raw_proto?: Buffer | null;
}

export interface ContactUpsert {
  id: ChatId;
  name?: string | null;
  pushname?: string | null;
  number?: string | null;
  /** WhatsApp's per-group privacy ID. Lets us resolve group message senders
   *  (which arrive as `@lid`) back to the saved contact name. */
  lid?: string | null;
}

export type MediaRefUpsert = MediaIndexEntry;

interface MessageRow {
  id: string;
  chat_id: string;
  timestamp: number;
  sender_id: string | null;
  from_me: number;
  author: string | null;
  body: string | null;
  type: string;
  has_media: number;
  reply_to_message_id: string | null;
  edited_at: number | null;
  read_by_recipient: number | null;
  reactions: string;
  /** Resolved via contacts JOIN; null when no row matches the sender_id. */
  sender_name: string | null;
}

interface ChatRow {
  id: string;
  name: string | null;
  is_group: number;
  is_muted: number | null;
  unread_count: number | null;
  last_message_timestamp: number | null;
  last_message_preview: string | null;
  last_message_from_me: number | null;
}

const MESSAGE_COLS =
  'm.id, m.chat_id, m.timestamp, m.sender_id, m.from_me, m.author, m.body, m.type, m.has_media, m.reply_to_message_id, m.edited_at, m.read_by_recipient, m.reactions, COALESCE(c.name, c.pushname) AS sender_name';
// LEFT JOIN: a sender is matched by either form of its handle. Contacts
// arrive keyed by either jid or lid depending on context; the OR makes both
// resolvable. With idx_contacts_lid + the PK on id, SQLite handles this fine
// at our scale.
const MESSAGES_FROM =
  'FROM messages m LEFT JOIN contacts c ON c.id = m.sender_id OR c.lid = m.sender_id';

export class Store {
  private db: DB;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    migrate(this.db);
    this.prepareStatements();
  }

  close(): void {
    this.db.close();
  }

  // --- prepared statements (built once) ---
  private stmts!: Record<string, Database.Statement>;

  private prepareStatements(): void {
    this.stmts = {
      upsertChat: this.db.prepare(`
        INSERT INTO chats (id, name, is_group, is_muted, unread_count,
          last_message_timestamp, last_message_preview, last_message_from_me)
        VALUES (@id, @name, @is_group, @is_muted, @unread_count,
          @last_message_timestamp, @last_message_preview, @last_message_from_me)
        ON CONFLICT(id) DO UPDATE SET
          name = COALESCE(excluded.name, chats.name),
          is_group = excluded.is_group,
          is_muted = COALESCE(excluded.is_muted, chats.is_muted),
          unread_count = COALESCE(excluded.unread_count, chats.unread_count),
          last_message_timestamp =
            COALESCE(excluded.last_message_timestamp, chats.last_message_timestamp),
          last_message_preview =
            COALESCE(excluded.last_message_preview, chats.last_message_preview),
          last_message_from_me =
            COALESCE(excluded.last_message_from_me, chats.last_message_from_me)
      `),
      upsertMessage: this.db.prepare(`
        INSERT INTO messages (id, chat_id, timestamp, sender_id, from_me, author,
          body, type, has_media, reply_to_message_id, edited_at,
          read_by_recipient, raw_proto)
        VALUES (@id, @chat_id, @timestamp, @sender_id, @from_me, @author,
          @body, @type, @has_media, @reply_to_message_id, @edited_at,
          @read_by_recipient, @raw_proto)
        ON CONFLICT(chat_id, id) DO UPDATE SET
          timestamp = excluded.timestamp,
          sender_id = COALESCE(excluded.sender_id, messages.sender_id),
          author = COALESCE(excluded.author, messages.author),
          body = COALESCE(excluded.body, messages.body),
          type = excluded.type,
          has_media = excluded.has_media,
          reply_to_message_id =
            COALESCE(excluded.reply_to_message_id, messages.reply_to_message_id),
          edited_at = COALESCE(excluded.edited_at, messages.edited_at),
          read_by_recipient =
            COALESCE(excluded.read_by_recipient, messages.read_by_recipient),
          raw_proto = COALESCE(excluded.raw_proto, messages.raw_proto)
      `),
      setReactions: this.db.prepare(
        `UPDATE messages SET reactions = @reactions WHERE chat_id = @chat_id AND id = @id`,
      ),
      setReceipt: this.db.prepare(
        `UPDATE messages SET read_by_recipient = @read_by_recipient WHERE chat_id = @chat_id AND id = @id`,
      ),
      setEdited: this.db.prepare(
        `UPDATE messages SET body = @body, edited_at = @edited_at WHERE chat_id = @chat_id AND id = @id`,
      ),
      setSender: this.db.prepare(
        `UPDATE messages SET sender_id = @sender_id, author = @author
         WHERE chat_id = @chat_id AND id = @id`,
      ),
      listNullSenderGroupRows: this.db.prepare(
        `SELECT chat_id, id, raw_proto FROM messages
         WHERE from_me = 0
           AND sender_id IS NULL
           AND raw_proto IS NOT NULL
           AND chat_id LIKE '%@g.us'
         LIMIT @limit`,
      ),
      applyLastMessage: this.db.prepare(`
        INSERT INTO chats (id, is_group, last_message_timestamp,
          last_message_preview, last_message_from_me)
        VALUES (@id, @is_group, @ts, @preview, @from_me)
        ON CONFLICT(id) DO UPDATE SET
          last_message_timestamp = @ts,
          last_message_preview = @preview,
          last_message_from_me = @from_me
        WHERE @ts >= COALESCE(chats.last_message_timestamp, 0)
      `),
      upsertContact: this.db.prepare(`
        INSERT INTO contacts (id, name, pushname, number, lid)
        VALUES (@id, @name, @pushname, @number, @lid)
        ON CONFLICT(id) DO UPDATE SET
          name = COALESCE(excluded.name, contacts.name),
          pushname = COALESCE(excluded.pushname, contacts.pushname),
          number = COALESCE(excluded.number, contacts.number),
          lid = COALESCE(excluded.lid, contacts.lid)
      `),
      upsertMedia: this.db.prepare(`
        INSERT INTO media_refs (message_id, chat_id, timestamp, type, mime_type,
          file_name, caption, file_size_bytes)
        VALUES (@message_id, @chat_id, @timestamp, @type, @mime_type,
          @file_name, @caption, @file_size_bytes)
        ON CONFLICT(chat_id, message_id) DO UPDATE SET
          type = excluded.type,
          mime_type = COALESCE(excluded.mime_type, media_refs.mime_type),
          file_name = COALESCE(excluded.file_name, media_refs.file_name),
          caption = COALESCE(excluded.caption, media_refs.caption),
          file_size_bytes =
            COALESCE(excluded.file_size_bytes, media_refs.file_size_bytes)
      `),
    };
  }

  // ===================== Writes =====================

  upsertChat(c: ChatUpsert): void {
    this.stmts.upsertChat.run({
      id: c.id,
      name: c.name ?? null,
      is_group: c.is_group ? 1 : 0,
      is_muted: c.is_muted == null ? null : c.is_muted ? 1 : 0,
      unread_count: c.unread_count ?? null,
      last_message_timestamp: c.last_message_timestamp ?? null,
      last_message_preview: c.last_message_preview ?? null,
      last_message_from_me:
        c.last_message_from_me == null ? null : c.last_message_from_me ? 1 : 0,
    });
  }

  upsertChats(rows: ChatUpsert[]): void {
    this.db.transaction((items: ChatUpsert[]) => {
      for (const r of items) this.upsertChat(r);
    })(rows);
  }

  upsertMessage(m: MessageUpsert): void {
    this.stmts.upsertMessage.run({
      id: m.id,
      chat_id: m.chat_id,
      timestamp: m.timestamp,
      sender_id: m.sender_id ?? null,
      from_me: m.from_me ? 1 : 0,
      author: m.author ?? null,
      body: m.body ?? null,
      type: m.type,
      has_media: m.has_media ? 1 : 0,
      reply_to_message_id: m.reply_to_message_id ?? null,
      edited_at: m.edited_at ?? null,
      read_by_recipient:
        m.read_by_recipient == null ? null : m.read_by_recipient ? 1 : 0,
      raw_proto: m.raw_proto ?? null,
    });
  }

  upsertMessages(rows: MessageUpsert[]): void {
    this.db.transaction((items: MessageUpsert[]) => {
      for (const r of items) this.upsertMessage(r);
    })(rows);
  }

  setReactions(chatId: ChatId, messageId: MessageId, reactions: Reaction[]): void {
    this.stmts.setReactions.run({
      chat_id: chatId,
      id: messageId,
      reactions: JSON.stringify(reactions),
    });
  }

  setReadByRecipient(chatId: ChatId, messageId: MessageId, read: boolean): void {
    this.stmts.setReceipt.run({
      chat_id: chatId,
      id: messageId,
      read_by_recipient: read ? 1 : 0,
    });
  }

  setMessageSender(
    chatId: ChatId,
    messageId: MessageId,
    senderId: string | null,
    author: string | null,
  ): void {
    this.stmts.setSender.run({
      chat_id: chatId,
      id: messageId,
      sender_id: senderId,
      author,
    });
  }

  /** Rows that look like incoming group messages whose sender was dropped
   *  (e.g. by the pre-fix mapper that only read key.participant). `limit`
   *  caps the chunk so the backfill can stream through a large store. */
  listNullSenderGroupRows(
    limit: number,
  ): Array<{ chat_id: ChatId; id: MessageId; raw_proto: Buffer }> {
    return this.stmts.listNullSenderGroupRows.all({ limit }) as Array<{
      chat_id: ChatId;
      id: MessageId;
      raw_proto: Buffer;
    }>;
  }

  setEdited(
    chatId: ChatId,
    messageId: MessageId,
    body: string | null,
    editedAt: number,
  ): void {
    this.stmts.setEdited.run({
      chat_id: chatId,
      id: messageId,
      body,
      edited_at: editedAt,
    });
  }

  /**
   * Update a chat's last-message summary, but only if this message is at
   * least as recent as what is already stored (so replaying old history does
   * not clobber a newer preview). Creates the chat row if missing.
   */
  applyLastMessage(
    chatId: ChatId,
    isGroup: boolean,
    timestamp: number,
    preview: string | null,
    fromMe: boolean,
  ): void {
    this.stmts.applyLastMessage.run({
      id: chatId,
      is_group: isGroup ? 1 : 0,
      ts: timestamp,
      preview,
      from_me: fromMe ? 1 : 0,
    });
  }

  upsertContact(c: ContactUpsert): void {
    this.stmts.upsertContact.run({
      id: c.id,
      name: c.name ?? null,
      pushname: c.pushname ?? null,
      number: c.number ?? null,
      lid: c.lid ?? null,
    });
  }

  upsertContacts(rows: ContactUpsert[]): void {
    this.db.transaction((items: ContactUpsert[]) => {
      for (const r of items) this.upsertContact(r);
    })(rows);
  }

  upsertMediaRef(m: MediaRefUpsert): void {
    this.stmts.upsertMedia.run({
      message_id: m.message_id,
      chat_id: m.chat_id,
      timestamp: m.timestamp,
      type: m.type,
      mime_type: m.mime_type ?? null,
      file_name: m.file_name ?? null,
      caption: m.caption ?? null,
      file_size_bytes: m.file_size_bytes ?? null,
    });
  }

  // ===================== Reads =====================

  listChats(limit: number, offset: number): Chat[] {
    const rows = this.db
      .prepare(
        `SELECT id, name, is_group, is_muted, unread_count, last_message_timestamp,
                last_message_preview, last_message_from_me
         FROM chats
         ORDER BY last_message_timestamp DESC NULLS LAST
         LIMIT ? OFFSET ?`,
      )
      .all(limit, offset) as ChatRow[];
    return rows.map(rowToChat);
  }

  /** All group chat IDs, recent-activity-first. Used by the lid backfill. */
  listGroupChatIds(): ChatId[] {
    return (
      this.db
        .prepare(
          `SELECT id FROM chats WHERE is_group = 1
           ORDER BY last_message_timestamp DESC NULLS LAST`,
        )
        .all() as Array<{ id: string }>
    ).map((r) => r.id);
  }

  listChatsOverview(limit: number, offset: number): ChatOverview[] {
    const rows = this.db
      .prepare(
        `SELECT id, name, is_group, is_muted, unread_count, last_message_timestamp,
                last_message_preview, last_message_from_me
         FROM chats
         ORDER BY last_message_timestamp DESC NULLS LAST
         LIMIT ? OFFSET ?`,
      )
      .all(limit, offset) as ChatRow[];
    return rows.map(rowToChatOverview);
  }

  getChatMessages(params: {
    chat_id: ChatId;
    limit: number;
    before_timestamp?: number;
    after_timestamp?: number;
    from_me?: boolean;
  }): Message[] {
    const clauses = ['m.chat_id = @chat_id'];
    const bind: Record<string, unknown> = {
      chat_id: params.chat_id,
      limit: params.limit,
    };
    if (params.before_timestamp != null) {
      clauses.push('m.timestamp < @before');
      bind.before = params.before_timestamp;
    }
    if (params.after_timestamp != null) {
      clauses.push('m.timestamp > @after');
      bind.after = params.after_timestamp;
    }
    if (params.from_me != null) {
      clauses.push('m.from_me = @from_me');
      bind.from_me = params.from_me ? 1 : 0;
    }
    const rows = this.db
      .prepare(
        `SELECT ${MESSAGE_COLS} ${MESSAGES_FROM}
         WHERE ${clauses.join(' AND ')}
         ORDER BY m.timestamp DESC
         LIMIT @limit`,
      )
      .all(bind) as MessageRow[];
    return rows.map(rowToMessage);
  }

  getMessage(chatId: ChatId, messageId: MessageId): Message | null {
    const row = this.db
      .prepare(
        `SELECT ${MESSAGE_COLS} ${MESSAGES_FROM} WHERE m.chat_id = ? AND m.id = ?`,
      )
      .get(chatId, messageId) as MessageRow | undefined;
    return row ? rowToMessage(row) : null;
  }

  /** Raw encoded proto bytes for a message — used to re-download media. */
  getRawMessage(chatId: ChatId, messageId: MessageId): Buffer | null {
    const row = this.db
      .prepare(`SELECT raw_proto FROM messages WHERE chat_id = ? AND id = ?`)
      .get(chatId, messageId) as { raw_proto: Buffer | null } | undefined;
    return row?.raw_proto ?? null;
  }

  unreadSummary(): UnreadChatSummary[] {
    const rows = this.db
      .prepare(
        `SELECT id, name, is_group, is_muted, unread_count
         FROM chats WHERE unread_count > 0
         ORDER BY last_message_timestamp DESC NULLS LAST`,
      )
      .all() as Array<
      Pick<ChatRow, 'id' | 'name' | 'is_group' | 'is_muted' | 'unread_count'>
    >;
    return rows.map((r) => ({
      chat_id: r.id,
      name: r.name,
      is_group: !!r.is_group,
      is_muted: !!r.is_muted,
      unread_count: r.unread_count ?? 0,
    }));
  }

  searchMessages(
    query: string,
    maxChats: number,
    limitPerChat: number,
  ): Array<{ chat_id: ChatId; messages: Message[] }> {
    const match = toFtsQuery(query);
    if (!match) return [];
    const cap = Math.min(maxChats * limitPerChat * 4, 2000);
    const rows = this.db
      .prepare(
        `SELECT ${MESSAGE_COLS}
         FROM messages_fts f
         JOIN messages m ON m.rowid = f.rowid
         LEFT JOIN contacts c ON c.id = m.sender_id OR c.lid = m.sender_id
         WHERE messages_fts MATCH ?
         ORDER BY f.rank
         LIMIT ?`,
      )
      .all(match, cap) as MessageRow[];

    const byChat = new Map<ChatId, Message[]>();
    for (const row of rows) {
      const list = byChat.get(row.chat_id);
      if (list) {
        if (list.length < limitPerChat) list.push(rowToMessage(row));
      } else {
        if (byChat.size >= maxChats) continue;
        byChat.set(row.chat_id, [rowToMessage(row)]);
      }
    }
    return [...byChat.entries()].map(([chat_id, messages]) => ({
      chat_id,
      messages,
    }));
  }

  listChatMedia(
    chatId: ChatId,
    type: string | undefined,
    limit: number,
    offset: number,
  ): MediaIndexEntry[] {
    const clauses = ['chat_id = ?'];
    const bind: unknown[] = [chatId];
    if (type) {
      clauses.push('type = ?');
      bind.push(type);
    }
    bind.push(limit, offset);
    return this.db
      .prepare(
        `SELECT message_id, chat_id, timestamp, type, mime_type, file_name,
                caption, file_size_bytes
         FROM media_refs
         WHERE ${clauses.join(' AND ')}
         ORDER BY timestamp DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...bind) as MediaIndexEntry[];
  }

  listContacts(limit = 5000, offset = 0): ContactInfo[] {
    const rows = this.db
      .prepare(
        `SELECT id, name, pushname, number FROM contacts
         ORDER BY COALESCE(name, pushname, number, id) COLLATE NOCASE
         LIMIT ? OFFSET ?`,
      )
      .all(limit, offset) as Array<{
      id: string;
      name: string | null;
      pushname: string | null;
      number: string | null;
    }>;
    return rows.map(rowToContact);
  }

  searchContacts(query: string, limit: number): ContactInfo[] {
    const like = `%${query.replace(/[%_]/g, (m) => '\\' + m)}%`;
    const rows = this.db
      .prepare(
        `SELECT id, name, pushname, number FROM contacts
         WHERE name LIKE @q ESCAPE '\\'
            OR pushname LIKE @q ESCAPE '\\'
            OR number LIKE @q ESCAPE '\\'
            OR id LIKE @q ESCAPE '\\'
         ORDER BY COALESCE(name, pushname, number, id) COLLATE NOCASE
         LIMIT @limit`,
      )
      .all({ q: like, limit }) as Array<{
      id: string;
      name: string | null;
      pushname: string | null;
      number: string | null;
    }>;
    return rows.map(rowToContact);
  }

  getContactRow(
    id: ChatId,
  ): { id: string; name: string | null; pushname: string | null; number: string | null } | null {
    // Accept either form of handle. If the caller passes an @lid, match the
    // lid column; otherwise match by id PK. The OR is fine — contacts is
    // small and both lookups are indexed.
    const row = this.db
      .prepare(
        `SELECT id, name, pushname, number FROM contacts
         WHERE id = @id OR lid = @id
         LIMIT 1`,
      )
      .get({ id }) as
      | { id: string; name: string | null; pushname: string | null; number: string | null }
      | undefined;
    return row ?? null;
  }

  /** Oldest stored message in a chat — anchor for fetch_more_history. */
  oldestMessage(
    chatId: ChatId,
  ): { id: MessageId; timestamp: number; from_me: boolean; sender_id: string | null } | null {
    const row = this.db
      .prepare(
        `SELECT id, timestamp, from_me, sender_id FROM messages
         WHERE chat_id = ? ORDER BY timestamp ASC LIMIT 1`,
      )
      .get(chatId) as
      | { id: string; timestamp: number; from_me: number; sender_id: string | null }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      timestamp: row.timestamp,
      from_me: !!row.from_me,
      sender_id: row.sender_id,
    };
  }

  counts(): { chats: number; messages: number } {
    const chats = (
      this.db.prepare(`SELECT COUNT(*) AS n FROM chats`).get() as { n: number }
    ).n;
    const messages = (
      this.db.prepare(`SELECT COUNT(*) AS n FROM messages`).get() as { n: number }
    ).n;
    return { chats, messages };
  }
}

// ===================== Row mappers =====================

function rowToChat(r: ChatRow): Chat {
  return {
    id: r.id,
    name: r.name,
    is_group: !!r.is_group,
    is_muted: !!r.is_muted,
    unread_count: r.unread_count ?? 0,
    last_message_timestamp: r.last_message_timestamp,
  };
}

function rowToChatOverview(r: ChatRow): ChatOverview {
  return {
    ...rowToChat(r),
    last_message_preview: r.last_message_preview,
    last_message_from_me:
      r.last_message_from_me == null ? null : !!r.last_message_from_me,
  };
}

function rowToMessage(r: MessageRow): Message {
  let reactions: Reaction[] = [];
  try {
    reactions = JSON.parse(r.reactions) as Reaction[];
  } catch {
    reactions = [];
  }
  return {
    id: r.id,
    chat_id: r.chat_id,
    timestamp: r.timestamp,
    from: r.sender_id,
    from_me: !!r.from_me,
    author: r.author,
    sender_name: r.sender_name,
    body: r.body,
    type: r.type as MessageType,
    has_media: !!r.has_media,
    reactions,
    reply_to_message_id: r.reply_to_message_id,
    edited_at: r.edited_at,
    read_by_recipient:
      r.read_by_recipient == null ? null : !!r.read_by_recipient,
  };
}

function rowToContact(r: {
  id: string;
  name: string | null;
  pushname: string | null;
  number: string | null;
}): ContactInfo {
  return {
    kind: 'contact',
    id: r.id,
    name: r.name,
    pushname: r.pushname,
    number: r.number ?? '',
    profile_picture_url: null,
  };
}

/** Turn free text into a safe FTS5 MATCH expression (quoted AND of tokens). */
function toFtsQuery(query: string): string | null {
  const tokens = query
    .split(/\s+/)
    .map((t) => t.replace(/["']/g, '').trim())
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t}"`).join(' ');
}
