// WhatsApp connection lifecycle. Owns the single Baileys socket, wires its
// events into the SQLite store, and exposes a small typed surface (status,
// pairing, sync, history, media) for the controller and MCP server.
//
// READ-ONLY CONTRACT: this module never calls socket methods that mutate
// WhatsApp state — no sendMessage, readMessages, sendPresenceUpdate, chatModify
// (read receipts), or sendReceipt. markOnlineOnConnect is forced false so we
// never even announce presence. The only writes we make to WhatsApp are
// account-management (requestPairingCode, logout) — never to a conversation.

import { EventEmitter } from 'events';
import { rmSync } from 'fs';
import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
  Browsers,
  DisconnectReason,
  isJidGroup,
  jidNormalizedUser,
  proto,
} from '@whiskeysockets/baileys';
import type {
  WASocket,
  ConnectionState as WAConnectionState,
  WAMessage,
  GroupMetadata,
  Chat as WAChat,
  Contact as WAContact,
} from '@whiskeysockets/baileys';
import type { Boom } from '@hapi/boom';
import { Store } from '../store';
import { log, makeBaileysLogger } from '../backend/logger';
import { authDir } from '../backend/paths';
import {
  mapChat,
  mapContact,
  mapMessage,
  toNum,
  isIgnoredJid,
} from './mappers';
import type {
  BackendStatus,
  ConnectionState,
  PairingEvent,
  SyncProgress,
} from '../types/ipc';
import type { Reaction } from '../types/messages';

interface PairingMode {
  method: 'qr' | 'code';
  phoneE164?: string;
}

type Events = {
  status: (s: BackendStatus) => void;
  pairing: (e: PairingEvent) => void;
  sync: (p: SyncProgress) => void;
};

export class WhatsAppConnection {
  private sock: WASocket | null = null;
  private emitter = new EventEmitter();
  private connState: ConnectionState = 'unpaired';
  private lastError: string | null = null;
  private lastSyncAt: number | null = null;
  private account: { name: string; number: string } | null = null;

  private intentionalStop = false;
  private reconnectAttempts = 0;
  private pairingMode: PairingMode | null = null;
  private pairingCodeRequested = false;

  private syncCounters = { chats: 0, messages: 0 };
  private initialSyncResolved = false;
  private initialSyncWaiters: Array<() => void> = [];
  private initialSyncTimer: NodeJS.Timeout | null = null;

  constructor(private store: Store) {}

  // ---- subscriptions ----
  on<E extends keyof Events>(event: E, handler: Events[E]): () => void {
    this.emitter.on(event, handler as (...args: unknown[]) => void);
    return () => this.emitter.off(event, handler as (...args: unknown[]) => void);
  }

  // ---- public status ----
  getStatus(): BackendStatus {
    const counts = this.store.counts();
    return {
      connection: this.connState,
      paired_account: this.account,
      last_sync_at: this.lastSyncAt,
      last_error: this.lastError,
      store_chat_count: counts.chats,
      store_message_count: counts.messages,
    };
  }

  isConnected(): boolean {
    return this.connState === 'connected' || this.connState === 'syncing';
  }

  /**
   * Connect using existing auth (no-op if already connecting/connected).
   * Resolves once the socket is created; use waitForInitialSync() to block on
   * the post-connect history sync.
   */
  async start(): Promise<void> {
    if (this.sock) return;
    this.intentionalStop = false;
    await this.connectSocket();
  }

  async stop(): Promise<void> {
    this.intentionalStop = true;
    this.clearInitialSyncTimer();
    const sock = this.sock;
    this.sock = null;
    if (sock) {
      try {
        sock.end(undefined);
      } catch (err) {
        log.warn('socket end error', err);
      }
    }
    this.setConnState('disconnected');
  }

  /**
   * Begin a fresh pairing. Wipes any existing auth so the socket comes up
   * unregistered, then connects and drives the chosen pairing method.
   */
  async startPairing(opts: PairingMode): Promise<void> {
    await this.stop();
    this.wipeAuth();
    this.account = null;
    this.pairingMode = opts;
    this.pairingCodeRequested = false;
    this.intentionalStop = false;
    await this.connectSocket();
  }

  async cancelPairing(): Promise<void> {
    this.pairingMode = null;
    this.pairingCodeRequested = false;
    await this.stop();
    this.setConnState('unpaired');
  }

  /** Unlink this device from WhatsApp and wipe local credentials. */
  async unlink(): Promise<void> {
    const sock = this.sock;
    this.intentionalStop = true;
    if (sock) {
      try {
        // logout() is account self-management (removes OUR linked device),
        // not a conversation mutation — permitted under the read-only contract.
        await sock.logout();
      } catch (err) {
        log.warn('logout error (continuing to wipe local auth)', err);
      }
    }
    this.sock = null;
    this.wipeAuth();
    this.account = null;
    this.setConnState('unpaired');
  }

  /**
   * Block until the post-connect initial history sync has landed (or the
   * timeout elapses). The MCP server calls this before answering the first
   * tool call so Claude sees a populated store.
   */
  waitForInitialSync(timeoutMs = 12000): Promise<void> {
    if (this.initialSyncResolved) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => resolve();
      this.initialSyncWaiters.push(done);
      setTimeout(() => {
        // resolve this waiter regardless so tool calls never hang forever
        const idx = this.initialSyncWaiters.indexOf(done);
        if (idx >= 0) this.initialSyncWaiters.splice(idx, 1);
        resolve();
      }, timeoutMs);
    });
  }

  // ===================== socket setup =====================

  private async connectSocket(): Promise<void> {
    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    const { version } = await fetchLatestBaileysVersion().catch(() => ({
      version: undefined as unknown as [number, number, number],
    }));

    if (!state.creds.registered && !this.pairingMode) {
      // No credentials and not actively pairing: we're unpaired. There is
      // nothing to sync, so open the gate immediately — tool calls must not
      // block waiting for a sync that will never happen.
      this.setConnState('unpaired');
      this.resolveInitialSync(false);
    } else {
      this.setConnState('connecting');
    }

    const sock = makeWASocket({
      auth: state,
      version,
      logger: makeBaileysLogger('warn') as never,
      browser: Browsers.macOS('WhatsAppMCP'),
      markOnlineOnConnect: false, // never announce presence (read-only)
      syncFullHistory: false, // shallow first sync; deepen on demand
      printQRInTerminal: false,
      // We never resend; returning undefined is safe for a read-only client.
      getMessage: async () => undefined,
    });
    this.sock = sock;

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (u) => this.onConnectionUpdate(u));
    this.bindStoreEvents(sock);
  }

  private async onConnectionUpdate(
    u: Partial<WAConnectionState>,
  ): Promise<void> {
    const { connection, lastDisconnect, qr } = u;

    if (qr) {
      await this.handlePairingArtifact(qr);
    }

    if (connection === 'connecting') {
      this.setConnState('connecting');
    } else if (connection === 'open') {
      this.reconnectAttempts = 0;
      this.account = this.deriveAccount();
      this.setConnState('syncing');
      this.armInitialSyncFallback();
      if (this.pairingMode) {
        this.pairingMode = null;
        this.pairingCodeRequested = false;
        if (this.account) {
          this.emitter.emit('pairing', {
            kind: 'success',
            account: this.account,
          } satisfies PairingEvent);
        }
      }
      log.info('connection open', this.account);
    } else if (connection === 'close') {
      await this.onClose(lastDisconnect?.error as Boom | undefined);
    }
  }

  private async handlePairingArtifact(qr: string): Promise<void> {
    if (this.pairingMode?.method === 'code') {
      if (this.pairingCodeRequested) return;
      this.pairingCodeRequested = true;
      const phone = (this.pairingMode.phoneE164 ?? '').replace(/[^0-9]/g, '');
      try {
        const code = await this.sock!.requestPairingCode(phone);
        this.emitter.emit('pairing', {
          kind: 'code',
          code,
        } satisfies PairingEvent);
        log.info('pairing code issued');
      } catch (err) {
        this.lastError = errMessage(err);
        this.emitter.emit('pairing', {
          kind: 'error',
          message: this.lastError,
        } satisfies PairingEvent);
        log.error('requestPairingCode failed', err);
      }
    } else {
      // QR mode (default when no explicit pairing in progress and unregistered)
      this.emitter.emit('pairing', {
        kind: 'qr',
        payload: qr,
      } satisfies PairingEvent);
    }
  }

  private async onClose(error: Boom | undefined): Promise<void> {
    const statusCode = error?.output?.statusCode;
    this.sock = null;

    if (statusCode === DisconnectReason.loggedOut) {
      log.warn('logged out by WhatsApp; wiping auth');
      this.wipeAuth();
      this.account = null;
      this.setConnState('unpaired');
      return;
    }

    if (this.intentionalStop) {
      this.setConnState('disconnected');
      return;
    }

    if (statusCode === DisconnectReason.connectionReplaced) {
      // Another process (likely the GUI/MCP sibling) claimed the device.
      // Yield: do not fight for the socket. See PLANNING "Socket ownership".
      log.warn('connection replaced by another session; yielding');
      this.lastError = 'Connection taken over by another window/process';
      this.setConnState('disconnected');
      return;
    }

    if (statusCode === DisconnectReason.restartRequired) {
      log.info('restart required; reconnecting immediately');
      await this.connectSocket();
      return;
    }

    // Generic transient failure: reconnect with capped backoff.
    this.reconnectAttempts += 1;
    if (this.reconnectAttempts > 10) {
      this.lastError = errMessage(error) || 'Repeated disconnects';
      this.setConnState('error');
      return;
    }
    const delay = Math.min(30000, 1000 * 2 ** (this.reconnectAttempts - 1));
    this.setConnState('connecting');
    log.warn(`disconnected (${statusCode}); reconnecting in ${delay}ms`);
    setTimeout(() => {
      if (!this.intentionalStop) void this.connectSocket();
    }, delay);
  }

  // ===================== event -> store wiring =====================

  private bindStoreEvents(sock: WASocket): void {
    sock.ev.on('messaging-history.set', (h) => {
      try {
        this.onHistory(h);
      } catch (err) {
        log.error('history.set handler error', err);
      }
    });

    sock.ev.on('messages.upsert', ({ messages }) => {
      try {
        this.persistMessages(messages);
        this.lastSyncAt = nowSeconds();
        this.emitStatus();
      } catch (err) {
        log.error('messages.upsert handler error', err);
      }
    });

    sock.ev.on('messages.update', (updates) => {
      for (const { key, update } of updates) {
        try {
          if (!key.id || isIgnoredJid(key.remoteJid)) continue;
          const chatId = jidNormalizedUser(key.remoteJid!) || key.remoteJid!;
          if (update.status != null && key.fromMe) {
            this.store.setReadByRecipient(chatId, key.id, update.status >= 4);
          }
        } catch (err) {
          log.error('messages.update handler error', err);
        }
      }
    });

    sock.ev.on('messages.reaction', (reactions) => {
      for (const r of reactions) {
        try {
          this.applyReaction(r.key, r.reaction);
        } catch (err) {
          log.error('messages.reaction handler error', err);
        }
      }
    });

    sock.ev.on('message-receipt.update', (receipts) => {
      for (const { key, receipt } of receipts) {
        try {
          if (!key.id || !key.fromMe || isIgnoredJid(key.remoteJid)) continue;
          const chatId = jidNormalizedUser(key.remoteJid!) || key.remoteJid!;
          if (receipt.readTimestamp || receipt.playedTimestamp) {
            this.store.setReadByRecipient(chatId, key.id, true);
          }
        } catch (err) {
          log.error('message-receipt handler error', err);
        }
      }
    });

    sock.ev.on('chats.upsert', (chats) => this.persistChats(chats));
    sock.ev.on('chats.update', (chats) => this.persistChats(chats));

    sock.ev.on('contacts.upsert', (contacts) => this.persistContacts(contacts));
    sock.ev.on('contacts.update', (contacts) => this.persistContacts(contacts));

    sock.ev.on('groups.upsert', (groups) => this.persistGroups(groups));
    sock.ev.on('groups.update', (groups) =>
      this.persistGroups(groups as Partial<GroupMetadata>[]),
    );
  }

  private onHistory(h: {
    chats: WAChat[];
    contacts: WAContact[];
    messages: WAMessage[];
    isLatest?: boolean;
    progress?: number | null;
    syncType?: number;
  }): void {
    this.persistChats(h.chats);
    this.persistContacts(h.contacts);
    this.persistMessages(h.messages);
    this.syncCounters.chats += h.chats.length;
    this.syncCounters.messages += h.messages.length;
    this.lastSyncAt = nowSeconds();

    const progress: SyncProgress = {
      phase: 'initial',
      chats_synced: this.syncCounters.chats,
      messages_synced: this.syncCounters.messages,
      initial_complete: !!h.isLatest,
    };
    this.emitter.emit('sync', progress);
    this.emitStatus();

    if (h.isLatest) this.resolveInitialSync();
  }

  private persistMessages(messages: WAMessage[]): void {
    const ownJid = this.ownJid();
    for (const msg of messages) {
      const mapped = mapMessage(msg, ownJid);
      if (!mapped) continue;
      this.store.upsertMessage(mapped.message);
      if (mapped.media) this.store.upsertMediaRef(mapped.media);
      if (mapped.reactions) {
        this.store.setReactions(
          mapped.message.chat_id,
          mapped.message.id,
          mapped.reactions,
        );
      }
      const p = mapped.chatPreview;
      this.store.applyLastMessage(
        p.chatId,
        p.isGroup,
        p.timestamp,
        p.preview,
        p.fromMe,
      );
    }
  }

  private persistChats(chats: Partial<WAChat>[]): void {
    const now = nowSeconds();
    const rows = [];
    for (const c of chats) {
      if (!c.id || isIgnoredJid(c.id)) continue;
      rows.push(mapChat({ ...c, id: c.id }, now));
    }
    if (rows.length) this.store.upsertChats(rows);
  }

  private persistContacts(contacts: Partial<WAContact>[]): void {
    const rows = [];
    for (const c of contacts) {
      if (!c.id) continue;
      const mapped = mapContact({ ...c, id: c.id });
      if (mapped) rows.push(mapped);
    }
    if (rows.length) this.store.upsertContacts(rows);
  }

  private persistGroups(groups: Partial<GroupMetadata>[]): void {
    for (const g of groups) {
      if (!g.id) continue;
      this.store.upsertChat({
        id: jidNormalizedUser(g.id) || g.id,
        name: g.subject ?? undefined,
        is_group: true,
      });
    }
  }

  private applyReaction(
    key: proto.IMessageKey,
    reaction: proto.IReaction,
  ): void {
    if (!key.id || isIgnoredJid(key.remoteJid)) return;
    const chatId = jidNormalizedUser(key.remoteJid!) || key.remoteJid!;
    const existing = this.store.getMessage(chatId, key.id);
    if (!existing) return; // can't react to a message we don't have
    const by =
      jidNormalizedUser(
        reaction.key?.participant || reaction.key?.remoteJid || '',
      ) || '';
    const next: Reaction[] = existing.reactions.filter((r) => r.by !== by);
    if (reaction.text) {
      next.push({
        emoji: reaction.text,
        by,
        timestamp: toNum(reaction.senderTimestampMs),
      });
    }
    this.store.setReactions(chatId, key.id, next);
  }

  // ===================== history / media =====================

  /**
   * Pull older messages for a chat from WhatsApp and persist them. Resolves
   * with how many new rows landed and the oldest timestamp now in the store.
   */
  async fetchMoreHistory(
    chatId: string,
    beforeTimestamp: number | undefined,
    count: number,
  ): Promise<{ fetched_count: number; oldest_in_store_timestamp: number | null }> {
    const sock = this.sock;
    if (!sock) throw new Error('Not connected');

    const anchor = this.store.oldestMessage(chatId);
    if (!anchor) {
      // Nothing stored yet for this chat; we have no key to anchor the request.
      return { fetched_count: 0, oldest_in_store_timestamp: null };
    }
    const beforeCount = this.store.counts().messages;
    const oldestTs = beforeTimestamp ?? anchor.timestamp;

    const key: proto.IMessageKey = {
      remoteJid: chatId,
      fromMe: anchor.from_me,
      id: anchor.id,
      participant:
        isJidGroup(chatId) && anchor.sender_id ? anchor.sender_id : undefined,
    };

    // fetchMessageHistory is a READ request — it asks WA to resend old
    // messages, which then arrive via 'messaging-history.set' (ON_DEMAND).
    await sock.fetchMessageHistory(count, key, oldestTs);

    await this.waitForHistoryResponse();

    const afterCount = this.store.counts().messages;
    const newOldest = this.store.oldestMessage(chatId);
    return {
      fetched_count: Math.max(0, afterCount - beforeCount),
      oldest_in_store_timestamp: newOldest?.timestamp ?? null,
    };
  }

  /** Wait briefly for an on-demand history batch to be persisted. */
  private waitForHistoryResponse(timeoutMs = 8000): Promise<void> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        unsub();
        resolve();
      };
      const unsub = this.on('sync', () => {
        // a history batch landed; give a short grace for more, then resolve
        setTimeout(finish, 300);
      });
      setTimeout(finish, timeoutMs);
    });
  }

  /** Download a media message's decrypted bytes from a stored raw proto. */
  async downloadMedia(
    chatId: string,
    messageId: string,
  ): Promise<{ data: Buffer; mime: string; type: string } | null> {
    const raw = this.store.getRawMessage(chatId, messageId);
    if (!raw) return null;
    const sock = this.sock;
    if (!sock) throw new Error('Not connected');

    const msg = proto.WebMessageInfo.decode(raw);
    const buffer = (await downloadMediaMessage(
      msg,
      'buffer',
      {},
      {
        logger: makeBaileysLogger('warn') as never,
        reuploadRequest: sock.updateMediaMessage,
      },
    )) as Buffer;

    const media = this.store.listChatMedia(chatId, undefined, 500, 0).find(
      (m) => m.message_id === messageId,
    );
    return {
      data: buffer,
      mime: media?.mime_type || 'application/octet-stream',
      type: media?.type || 'document',
    };
  }

  /** Live group metadata (participants, admins, settings). */
  async getGroupMetadata(jid: string): Promise<GroupMetadata | null> {
    const sock = this.sock;
    if (!sock) return null;
    try {
      return await sock.groupMetadata(jid);
    } catch (err) {
      log.warn('groupMetadata failed', err);
      return null;
    }
  }

  // ===================== internals =====================

  private armInitialSyncFallback(): void {
    this.clearInitialSyncTimer();
    // If no 'isLatest' history event arrives, consider the initial sync done
    // a few seconds after the connection opens so tool calls don't hang.
    this.initialSyncTimer = setTimeout(() => this.resolveInitialSync(), 8000);
  }

  private resolveInitialSync(markSynced = true): void {
    if (this.initialSyncResolved) return;
    this.initialSyncResolved = true;
    this.clearInitialSyncTimer();
    if (markSynced) {
      this.lastSyncAt = nowSeconds();
      if (this.connState === 'syncing') this.setConnState('connected');
      log.info('initial sync complete', this.syncCounters);
    }
    const waiters = this.initialSyncWaiters;
    this.initialSyncWaiters = [];
    for (const w of waiters) w();
  }

  private clearInitialSyncTimer(): void {
    if (this.initialSyncTimer) {
      clearTimeout(this.initialSyncTimer);
      this.initialSyncTimer = null;
    }
  }

  private deriveAccount(): { name: string; number: string } | null {
    const user = this.sock?.user;
    if (!user?.id) return this.account;
    const number = user.id.split(':')[0].split('@')[0];
    return { name: user.name || user.verifiedName || number, number };
  }

  private ownJid(): string | null {
    const id = this.sock?.user?.id;
    return id ? jidNormalizedUser(id) : null;
  }

  private wipeAuth(): void {
    try {
      rmSync(authDir, { recursive: true, force: true });
    } catch (err) {
      log.warn('wipeAuth failed', err);
    }
  }

  private setConnState(s: ConnectionState): void {
    if (this.connState === s) return;
    this.connState = s;
    this.emitStatus();
  }

  private emitStatus(): void {
    this.emitter.emit('status', this.getStatus());
  }
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
