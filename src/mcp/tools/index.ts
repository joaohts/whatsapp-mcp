// Tool registry: maps each ToolName from the contract to its handler module.
// server.ts iterates TOOLS and dispatches through this map, so adding a tool
// means adding a file here and an entry in src/types/tools.ts.

import type { ToolName } from '../../types/tools';
import type { ToolHandler } from '../context';

import list_chats from './list_chats';
import chats_overview from './chats_overview';
import get_chat_messages from './get_chat_messages';
import get_message from './get_message';
import unread_summary from './unread_summary';
import search_messages from './search_messages';
import fetch_more_history from './fetch_more_history';
import list_chat_media from './list_chat_media';
import download_media from './download_media';
import list_contacts from './list_contacts';
import search_contacts from './search_contacts';
import get_contact from './get_contact';

export const HANDLERS: Record<ToolName, ToolHandler> = {
  list_chats,
  chats_overview,
  get_chat_messages,
  get_message,
  unread_summary,
  search_messages,
  fetch_more_history,
  list_chat_media,
  download_media,
  list_contacts,
  search_contacts,
  get_contact,
};
