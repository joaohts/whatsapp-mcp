// Pure translation from Baileys protocol objects into store upsert rows.
// No socket calls here — just shape mapping, so it is trivially testable and
// has zero side-effects (keeps the read-only contract obvious).

import {
  proto,
  getContentType,
  normalizeMessageContent,
  isJidGroup,
  isJidBroadcast,
  isJidStatusBroadcast,
  isJidNewsletter,
  jidNormalizedUser,
  jidDecode,
} from '@whiskeysockets/baileys';
import type { WAMessage, Chat, Contact } from '@whiskeysockets/baileys';
import type {
  ChatUpsert,
  ContactUpsert,
  MediaRefUpsert,
  MessageUpsert,
} from '../store';
import type { MessageType, Reaction } from '../types/messages';

/** Long | number | null -> number (seconds/ids are small enough for JS). */
export function toNum(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  // Long instances expose toNumber()
  const maybe = v as { toNumber?: () => number; low?: number };
  if (typeof maybe.toNumber === 'function') return maybe.toNumber();
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Chats we never surface (status/stories/broadcasts/channels). */
export function isIgnoredJid(jid: string | null | undefined): boolean {
  if (!jid) return true;
  return !!(
    isJidStatusBroadcast(jid) ||
    isJidBroadcast(jid) ||
    isJidNewsletter(jid)
  );
}

const MEDIA_CONTENT_TYPES = new Set([
  'imageMessage',
  'videoMessage',
  'audioMessage',
  'documentMessage',
  'stickerMessage',
]);

const CONTENT_TYPE_TO_MESSAGE_TYPE: Record<string, MessageType> = {
  conversation: 'text',
  extendedTextMessage: 'text',
  imageMessage: 'image',
  videoMessage: 'video',
  audioMessage: 'audio',
  documentMessage: 'document',
  documentWithCaptionMessage: 'document',
  stickerMessage: 'sticker',
  locationMessage: 'location',
  liveLocationMessage: 'location',
  contactMessage: 'contact',
  contactsArrayMessage: 'contact',
  pollCreationMessage: 'poll',
  pollCreationMessageV2: 'poll',
  pollCreationMessageV3: 'poll',
};

const MEDIA_TYPE: Record<string, MediaRefUpsert['type']> = {
  imageMessage: 'image',
  videoMessage: 'video',
  audioMessage: 'audio',
  documentMessage: 'document',
  stickerMessage: 'sticker',
};

export interface MappedMessage {
  message: MessageUpsert;
  media?: MediaRefUpsert;
  reactions?: Reaction[];
  /** For updating the chat's last-message summary. */
  chatPreview: {
    chatId: string;
    isGroup: boolean;
    timestamp: number;
    preview: string | null;
    fromMe: boolean;
  };
}

/**
 * Map a Baileys WAMessage to store rows. Returns null for messages that carry
 * no user-visible content (key distribution, app-state, pure protocol, or an
 * ignored chat like status broadcasts).
 */
export function mapMessage(
  msg: WAMessage,
  ownJid: string | null,
): MappedMessage | null {
  const key = msg.key;
  const remoteJid = key?.remoteJid;
  if (!key?.id || isIgnoredJid(remoteJid)) return null;
  const chatId = jidNormalizedUser(remoteJid!) || remoteJid!;
  const isGroup = isJidGroup(chatId) ?? false;
  const fromMe = !!key.fromMe;

  const content = normalizeMessageContent(msg.message ?? undefined);
  const contentType = content ? getContentType(content) : undefined;

  const stubType = msg.messageStubType;
  const isStub = stubType != null && stubType !== 0;

  // No content and not a stub => nothing useful (protocol noise). Drop it.
  if (!contentType && !isStub) return null;
  // Pure protocol / key-distribution messages: drop.
  if (
    contentType === 'protocolMessage' ||
    contentType === 'senderKeyDistributionMessage' ||
    contentType === 'reactionMessage'
  ) {
    return null;
  }

  let type: MessageType =
    (contentType && CONTENT_TYPE_TO_MESSAGE_TYPE[contentType]) ||
    (isStub ? 'system' : 'unknown');

  const timestamp = toNum(msg.messageTimestamp);
  const body = extractBody(content, contentType) ?? (isStub ? stubBody(msg) : null);

  // Sender JID for group messages can live on either `key.participant` (the
  // older phone-number-style location) or `msg.participant` (the top-level
  // field where WhatsApp now puts the `@lid` privacy ID for newer groups).
  // Trying both is the empirically observed fix; without the fallback, every
  // @lid group message loses its sender and the store records null/null.
  const participantJid = key.participant ?? msg.participant ?? null;
  const author = isGroup && !fromMe ? normalizeOrNull(participantJid) : null;
  const sender = fromMe
    ? ownJid
    : isGroup
      ? normalizeOrNull(participantJid)
      : chatId;

  const replyTo = extractReplyTo(content, contentType);
  const readByRecipient = fromMe ? statusToRead(msg.status) : null;

  let raw: Buffer | null = null;
  try {
    raw = Buffer.from(proto.WebMessageInfo.encode(msg).finish());
  } catch {
    raw = null;
  }

  const hasMedia = !!contentType && MEDIA_CONTENT_TYPES.has(contentType);

  const message: MessageUpsert = {
    id: key.id,
    chat_id: chatId,
    timestamp,
    sender_id: sender,
    from_me: fromMe,
    author,
    body,
    type,
    has_media: hasMedia,
    reply_to_message_id: replyTo,
    edited_at: null,
    read_by_recipient: readByRecipient,
    raw_proto: raw,
  };

  let media: MediaRefUpsert | undefined;
  if (hasMedia && contentType) {
    media = extractMedia(content!, contentType, chatId, key.id, timestamp);
  }

  const reactions = extractReactions(msg);

  return {
    message,
    media,
    reactions,
    chatPreview: {
      chatId,
      isGroup,
      timestamp,
      preview: previewText(type, body),
      fromMe,
    },
  };
}

function normalizeOrNull(jid: string | null | undefined): string | null {
  if (!jid) return null;
  return jidNormalizedUser(jid) || jid;
}

function statusToRead(status: number | null | undefined): boolean | null {
  if (status == null) return null;
  // proto.WebMessageInfo.Status: READ = 4, PLAYED = 5
  return status >= 4;
}

function extractBody(
  content: proto.IMessage | undefined,
  contentType: string | undefined,
): string | null {
  if (!content || !contentType) return null;
  switch (contentType) {
    case 'conversation':
      return content.conversation ?? null;
    case 'extendedTextMessage':
      return content.extendedTextMessage?.text ?? null;
    case 'imageMessage':
      return content.imageMessage?.caption || null;
    case 'videoMessage':
      return content.videoMessage?.caption || null;
    case 'documentMessage':
      return content.documentMessage?.caption || null;
    case 'documentWithCaptionMessage':
      return (
        content.documentWithCaptionMessage?.message?.documentMessage?.caption ||
        null
      );
    case 'locationMessage':
      return locationBody(content.locationMessage);
    case 'contactMessage':
      return content.contactMessage?.displayName ?? null;
    case 'contactsArrayMessage':
      return content.contactsArrayMessage?.displayName ?? null;
    case 'pollCreationMessage':
    case 'pollCreationMessageV2':
    case 'pollCreationMessageV3': {
      const poll =
        content.pollCreationMessage ||
        content.pollCreationMessageV2 ||
        content.pollCreationMessageV3;
      return poll?.name ?? null;
    }
    default:
      return null;
  }
}

function locationBody(
  loc: proto.Message.ILocationMessage | null | undefined,
): string | null {
  if (!loc) return null;
  if (loc.name || loc.address) {
    return [loc.name, loc.address].filter(Boolean).join(' — ') || null;
  }
  if (loc.degreesLatitude != null && loc.degreesLongitude != null) {
    return `${loc.degreesLatitude}, ${loc.degreesLongitude}`;
  }
  return null;
}

function extractReplyTo(
  content: proto.IMessage | undefined,
  contentType: string | undefined,
): string | null {
  if (!content || !contentType) return null;
  const inner = (content as Record<string, unknown>)[contentType] as
    | { contextInfo?: proto.IContextInfo }
    | undefined;
  const ctx = inner?.contextInfo;
  return ctx?.stanzaId ?? null;
}

function extractMedia(
  content: proto.IMessage,
  contentType: string,
  chatId: string,
  messageId: string,
  timestamp: number,
): MediaRefUpsert | undefined {
  const type = MEDIA_TYPE[contentType];
  if (!type) return undefined;
  const m = (content as Record<string, unknown>)[contentType] as
    | {
        mimetype?: string | null;
        fileName?: string | null;
        caption?: string | null;
        fileLength?: unknown;
      }
    | undefined;
  if (!m) return undefined;
  return {
    message_id: messageId,
    chat_id: chatId,
    timestamp,
    type,
    mime_type: m.mimetype ?? '',
    file_name: m.fileName ?? null,
    caption: m.caption ?? null,
    file_size_bytes: m.fileLength != null ? toNum(m.fileLength) : null,
  };
}

export function extractReactions(msg: WAMessage): Reaction[] | undefined {
  const raw = msg.reactions;
  if (!raw || raw.length === 0) return undefined;
  const out: Reaction[] = [];
  for (const r of raw) {
    if (!r.text) continue; // removed reaction
    out.push({
      emoji: r.text,
      by: normalizeOrNull(r.key?.participant || r.key?.remoteJid) ?? '',
      timestamp: toNum(r.senderTimestampMs) || 0,
    });
  }
  return out.length ? out : undefined;
}

function previewText(type: MessageType, body: string | null): string | null {
  if (body) return body.length > 120 ? body.slice(0, 120) + '…' : body;
  switch (type) {
    case 'image':
      return '📷 Photo';
    case 'video':
      return '🎥 Video';
    case 'audio':
      return '🎤 Audio';
    case 'document':
      return '📄 Document';
    case 'sticker':
      return 'Sticker';
    case 'location':
      return '📍 Location';
    case 'contact':
      return '👤 Contact';
    case 'poll':
      return '📊 Poll';
    default:
      return null;
  }
}

function stubBody(msg: WAMessage): string | null {
  const stub = msg.messageStubType;
  if (stub == null) return null;
  const name = proto.WebMessageInfo.StubType[stub];
  return name ? name.toLowerCase().replace(/_/g, ' ') : null;
}

// ===================== Chats & contacts =====================

export function mapChat(
  chat: Partial<Chat> & { id: string },
  nowSeconds: number,
): ChatUpsert {
  const id = jidNormalizedUser(chat.id) || chat.id;
  const isGroup = isJidGroup(id) ?? false;
  const muteEnd = chat.muteEndTime != null ? toNum(chat.muteEndTime) : null;
  const isMuted =
    muteEnd == null ? undefined : muteEnd === -1 || muteEnd > nowSeconds;

  let unread: number | null | undefined =
    chat.unreadCount == null ? undefined : chat.unreadCount;
  if (unread != null && unread < 0) unread = 1; // -1 == "marked unread"

  return {
    id,
    name: chat.name || chat.displayName || undefined,
    is_group: isGroup,
    is_muted: isMuted,
    unread_count: unread,
    last_message_timestamp:
      chat.conversationTimestamp != null
        ? toNum(chat.conversationTimestamp)
        : undefined,
  };
}

export function mapContact(
  contact: Partial<Contact> & { id: string },
): ContactUpsert | null {
  const rawId = contact.id;
  if (!rawId || isIgnoredJid(rawId)) return null;
  const id = jidNormalizedUser(rawId) || rawId;
  const number = jidDecode(id)?.user ?? null;
  return {
    id,
    name: contact.name ?? null,
    pushname: contact.notify ?? null,
    number,
  };
}
