// Data shapes used in MCP tool responses and in the local SQLite store.
// Source of truth for both backend and GUI.

export type ChatId = string; // e.g. "5511...@c.us" (direct) or "...@g.us" (group)
export type MessageId = string;

export interface Chat {
  id: ChatId;
  name: string | null;
  is_group: boolean;
  is_muted: boolean;
  unread_count: number;
  last_message_timestamp: number | null;
}

export interface ChatOverview extends Chat {
  last_message_preview: string | null;
  last_message_from_me: boolean | null;
}

export type MessageType =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'sticker'
  | 'location'
  | 'contact'
  | 'poll'
  | 'system'
  | 'unknown';

export interface Reaction {
  emoji: string;
  by: ChatId;
  timestamp: number;
}

export interface Message {
  id: MessageId;
  chat_id: ChatId;
  timestamp: number;
  from: ChatId | null;
  from_me: boolean;
  /** In group chats: which participant sent it. Null for direct chats. */
  author: ChatId | null;
  body: string | null;
  type: MessageType;
  has_media: boolean;
  reactions: Reaction[];
  reply_to_message_id: MessageId | null;
  edited_at: number | null;
  /** For outbound messages: true if the recipient has read it (blue check). */
  read_by_recipient: boolean | null;
}

export interface ContactInfo {
  kind: 'contact';
  id: ChatId; // @c.us
  name: string | null;
  pushname: string | null;
  number: string;
  profile_picture_url: string | null;
}

export interface GroupInfo {
  kind: 'group';
  id: ChatId; // @g.us
  subject: string;
  description: string | null;
  created_at: number | null;
  participants: ChatId[];
  admins: ChatId[];
  only_admins_can_send: boolean;
}

export type ContactOrGroup = ContactInfo | GroupInfo;

export interface MediaIndexEntry {
  message_id: MessageId;
  chat_id: ChatId;
  timestamp: number;
  type: 'image' | 'video' | 'audio' | 'document' | 'sticker';
  mime_type: string;
  file_name: string | null;
  caption: string | null;
  file_size_bytes: number | null;
}

export interface UnreadChatSummary {
  chat_id: ChatId;
  name: string | null;
  is_group: boolean;
  is_muted: boolean;
  unread_count: number;
}
