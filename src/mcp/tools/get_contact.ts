import { jidNormalizedUser, jidDecode } from '@whiskeysockets/baileys';
import { json, requireStr, textError, ToolHandler } from '../context';
import type { ContactInfo, GroupInfo } from '../../types/messages';

const handler: ToolHandler = async (ctx, args) => {
  const chat_id = requireStr(args, 'chat_id');

  if (chat_id.endsWith('@g.us')) {
    const meta = await ctx.connection.getGroupMetadata(chat_id);
    if (!meta) {
      // Fall back to the stored chat name if we can't reach the live socket.
      const stored = ctx.store
        .listChats(500, 0)
        .find((c) => c.id === chat_id);
      if (!stored) {
        return textError(
          `Group ${chat_id} not found (not connected and not in local store).`,
        );
      }
      const partial: GroupInfo = {
        kind: 'group',
        id: chat_id,
        subject: stored.name ?? '',
        description: null,
        created_at: null,
        participants: [],
        admins: [],
        only_admins_can_send: false,
      };
      return json(partial);
    }
    const group: GroupInfo = {
      kind: 'group',
      id: chat_id,
      subject: meta.subject ?? '',
      description: meta.desc ?? null,
      created_at: meta.creation ?? null,
      participants: meta.participants.map(
        (p) => jidNormalizedUser(p.id) || p.id,
      ),
      admins: meta.participants
        .filter((p) => p.admin === 'admin' || p.admin === 'superadmin')
        .map((p) => jidNormalizedUser(p.id) || p.id),
      only_admins_can_send: !!meta.announce,
    };
    return json(group);
  }

  // Direct contact.
  const row = ctx.store.getContactRow(chat_id);
  const contact: ContactInfo = {
    kind: 'contact',
    id: chat_id,
    name: row?.name ?? null,
    pushname: row?.pushname ?? null,
    number: row?.number ?? jidDecode(chat_id)?.user ?? '',
    profile_picture_url: null,
  };
  return json(contact);
};

export default handler;
