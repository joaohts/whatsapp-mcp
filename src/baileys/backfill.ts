// One-shot repair for group messages stored before the mapper learned to look
// at `msg.participant` for the @lid sender (see mappers.ts). Walks rows with
// null sender + group chat_id + a stored raw_proto, re-extracts the
// participant JID from the proto, and writes it back via setMessageSender.
//
// Idempotent: it only touches rows where sender_id IS NULL, so subsequent
// daemon starts no-op after the first pass.

import { proto, jidNormalizedUser } from '@whiskeysockets/baileys';
import { Store } from '../store';
import { log } from '../backend/logger';
import type { WhatsAppConnection } from './connection';
import { mapContact } from './mappers';

const CHUNK_SIZE = 2000;

export interface BackfillStats {
  scanned: number;
  updated: number;
  unchanged: number;
  decode_failures: number;
}

export function backfillGroupSenders(store: Store): BackfillStats {
  const stats: BackfillStats = {
    scanned: 0,
    updated: 0,
    unchanged: 0,
    decode_failures: 0,
  };

  while (true) {
    const rows = store.listNullSenderGroupRows(CHUNK_SIZE);
    if (rows.length === 0) break;
    stats.scanned += rows.length;

    for (const row of rows) {
      let msg: proto.IWebMessageInfo;
      try {
        msg = proto.WebMessageInfo.decode(row.raw_proto);
      } catch {
        stats.decode_failures++;
        continue;
      }
      const participantJid =
        msg.key?.participant ?? msg.participant ?? null;
      if (!participantJid) {
        stats.unchanged++;
        continue;
      }
      const normalized = jidNormalizedUser(participantJid) || participantJid;
      store.setMessageSender(row.chat_id, row.id, normalized, normalized);
      stats.updated++;

      // Same proto carries msg.pushName — the sender's WhatsApp display name
      // at the time. Seed it into contacts so the sender_name JOIN resolves
      // even when group metadata didn't bring a name (very common: people in
      // shared groups who aren't in the user's address book).
      if (msg.pushName) {
        const isLid = normalized.endsWith('@lid');
        store.upsertContact({
          id: normalized,
          name: null,
          pushname: msg.pushName,
          number: null,
          lid: isLid ? normalized : null,
        });
      }
    }

    // If this chunk was all-no-op (everything was unchanged or failed), the
    // next chunk's query would return the same set forever. Break out so we
    // don't spin. The next daemon start will retry from scratch anyway.
    if (rows.length === stats.unchanged + stats.decode_failures) break;
  }

  if (stats.scanned > 0) {
    log.info(
      `backfillGroupSenders: scanned=${stats.scanned} updated=${stats.updated} unchanged=${stats.unchanged} decode_failures=${stats.decode_failures}`,
    );
  }
  return stats;
}

// ---- contact lid backfill ----
//
// Old contacts.upsert events were persisted without the lid field, and
// groups.upsert often doesn't re-fire for groups we already know about. As a
// result the contacts table can be missing the lid mappings needed to resolve
// group message senders (which arrive as @lid) to a saved-contact name. This
// helper walks every group chat in the store, asks Baileys for its current
// metadata (which carries the participant list with lid + jid both filled),
// and upserts each participant. Idempotent; rate-limited with a small delay
// to avoid hammering WA's groupMetadata endpoint.

const GROUP_METADATA_DELAY_MS = 200;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export interface ContactLidBackfillStats {
  groups_total: number;
  groups_succeeded: number;
  groups_failed: number;
  participants_upserted: number;
}

export async function backfillContactLids(
  store: Store,
  connection: WhatsAppConnection,
): Promise<ContactLidBackfillStats> {
  const stats: ContactLidBackfillStats = {
    groups_total: 0,
    groups_succeeded: 0,
    groups_failed: 0,
    participants_upserted: 0,
  };
  if (!connection.isConnected()) {
    log.info('backfillContactLids: connection not ready, skipping');
    return stats;
  }
  const groupIds = store.listGroupChatIds();
  stats.groups_total = groupIds.length;
  if (groupIds.length === 0) return stats;

  for (const groupId of groupIds) {
    try {
      const meta = await connection.getGroupMetadata(groupId);
      if (meta && Array.isArray(meta.participants)) {
        for (const p of meta.participants) {
          const row = mapContact(p);
          if (row) {
            store.upsertContact(row);
            stats.participants_upserted++;
          }
        }
        stats.groups_succeeded++;
      }
    } catch (err) {
      stats.groups_failed++;
      log.warn(`backfillContactLids: ${groupId} failed`, err);
    }
    await sleep(GROUP_METADATA_DELAY_MS);
  }

  log.info(
    `backfillContactLids: groups=${stats.groups_succeeded}/${stats.groups_total} failed=${stats.groups_failed} participants=${stats.participants_upserted}`,
  );
  return stats;
}

// ---- sender pushName backfill ----
//
// Every WAMessage proto carries msg.pushName — the sender's WhatsApp profile
// name at the time. For group participants we don't have in our address book,
// this is often the only available display name (groupMetadata's Contact
// rows can come back with id+lid and no name/notify). This helper walks
// stored group-message protos for senders with no name yet, extracts
// pushName, and upserts it into contacts so the sender_name JOIN resolves
// to something useful. Idempotent and chunked.

const PUSHNAME_CHUNK_SIZE = 2000;

export interface SenderPushNameBackfillStats {
  scanned: number;
  contacts_upserted: number;
  rows_without_pushname: number;
  decode_failures: number;
}

export function backfillSenderPushNames(store: Store): SenderPushNameBackfillStats {
  const stats: SenderPushNameBackfillStats = {
    scanned: 0,
    contacts_upserted: 0,
    rows_without_pushname: 0,
    decode_failures: 0,
  };

  // Stream by rowid so we make forward progress even when rows we visit get
  // their contact resolved mid-loop (the WHERE clause would otherwise filter
  // them on the next chunk and the iterator would loop forever on the same
  // unresolvable tail).
  let afterRowid = 0;
  while (true) {
    const rows = store.listGroupMessagesForPushNameBackfill(
      afterRowid,
      PUSHNAME_CHUNK_SIZE,
    );
    if (rows.length === 0) break;
    stats.scanned += rows.length;

    for (const row of rows) {
      afterRowid = row.rowid;
      let msg: proto.IWebMessageInfo;
      try {
        msg = proto.WebMessageInfo.decode(row.raw_proto);
      } catch {
        stats.decode_failures++;
        continue;
      }
      if (!msg.pushName) {
        stats.rows_without_pushname++;
        continue;
      }
      const isLid = row.sender_id.endsWith('@lid');
      store.upsertContact({
        id: row.sender_id,
        name: null,
        pushname: msg.pushName,
        number: null,
        lid: isLid ? row.sender_id : null,
      });
      stats.contacts_upserted++;
    }
  }

  if (stats.scanned > 0) {
    log.info(
      `backfillSenderPushNames: scanned=${stats.scanned} upserted=${stats.contacts_upserted} no_pushname=${stats.rows_without_pushname} decode_failures=${stats.decode_failures}`,
    );
  }
  return stats;
}
