// SQLite schema + migration runner. Single source of truth for the on-disk
// shape. Bump SCHEMA_VERSION and add a migration when the shape changes.

import type { Database } from 'better-sqlite3';

export const SCHEMA_VERSION = 2;

const DDL = `
-- is_muted / unread_count are nullable because chats.update events are
-- partial: an event that only carries a new unread count must leave the
-- other fields untouched (handled by COALESCE on upsert). Mappers coerce
-- null -> sensible defaults on read.
CREATE TABLE IF NOT EXISTS chats (
  id                      TEXT PRIMARY KEY,
  name                    TEXT,
  is_group                INTEGER NOT NULL DEFAULT 0,
  is_muted                INTEGER,
  unread_count            INTEGER,
  last_message_timestamp  INTEGER,
  last_message_preview    TEXT,
  last_message_from_me    INTEGER
);

CREATE INDEX IF NOT EXISTS idx_chats_last_ts
  ON chats(last_message_timestamp DESC);

CREATE TABLE IF NOT EXISTS messages (
  rowid                 INTEGER PRIMARY KEY,
  id                    TEXT NOT NULL,
  chat_id               TEXT NOT NULL,
  timestamp             INTEGER NOT NULL,
  sender_id             TEXT,
  from_me               INTEGER NOT NULL DEFAULT 0,
  author                TEXT,
  body                  TEXT,
  type                  TEXT NOT NULL,
  has_media             INTEGER NOT NULL DEFAULT 0,
  reply_to_message_id   TEXT,
  edited_at             INTEGER,
  read_by_recipient     INTEGER,
  reactions             TEXT NOT NULL DEFAULT '[]',
  raw_proto             BLOB,
  UNIQUE(chat_id, id)
);

CREATE INDEX IF NOT EXISTS idx_messages_chat_ts
  ON messages(chat_id, timestamp DESC);

CREATE TABLE IF NOT EXISTS contacts (
  id        TEXT PRIMARY KEY,
  name      TEXT,
  pushname  TEXT,
  number    TEXT,
  lid       TEXT
);
-- Index on lid is created by migrate() after the v1 -> v2 ALTER, because old
-- contacts tables don't have the column yet and DDL runs before the ALTER.

CREATE TABLE IF NOT EXISTS media_refs (
  message_id      TEXT NOT NULL,
  chat_id         TEXT NOT NULL,
  timestamp       INTEGER NOT NULL,
  type            TEXT NOT NULL,
  mime_type       TEXT,
  file_name       TEXT,
  caption         TEXT,
  file_size_bytes INTEGER,
  PRIMARY KEY (chat_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_media_chat_ts
  ON media_refs(chat_id, timestamp DESC);

-- Full-text search over message bodies, external-content linked to messages.
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  body,
  content='messages',
  content_rowid='rowid',
  tokenize='unicode61'
);

CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, body) VALUES (new.rowid, new.body);
END;

CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, body)
    VALUES ('delete', old.rowid, old.body);
END;

CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, body)
    VALUES ('delete', old.rowid, old.body);
  INSERT INTO messages_fts(rowid, body) VALUES (new.rowid, new.body);
END;
`;

export function migrate(db: Database): void {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(DDL);

  const current = (db.pragma('user_version', { simple: true }) as number) ?? 0;

  // v1 -> v2: add contacts.lid (WhatsApp's per-group privacy ID) so group
  // message senders, which arrive as @lid JIDs, can be resolved to a saved
  // contact name. Idempotent: if the column already exists (fresh DBs created
  // from the updated DDL above) the ALTER throws and we just skip it.
  if (current < 2) {
    try {
      db.exec('ALTER TABLE contacts ADD COLUMN lid TEXT');
    } catch {
      /* column already present */
    }
    db.exec('CREATE INDEX IF NOT EXISTS idx_contacts_lid ON contacts(lid)');
  }

  if (current < SCHEMA_VERSION) {
    db.pragma(`user_version = ${SCHEMA_VERSION}`);
  }
}
