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
