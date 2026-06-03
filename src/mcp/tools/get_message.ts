import { json, requireStr, textError, ToolHandler } from '../context';

const handler: ToolHandler = async (ctx, args) => {
  const chat_id = requireStr(args, 'chat_id');
  const message_id = requireStr(args, 'message_id');
  const msg = ctx.store.getMessage(chat_id, message_id);
  if (!msg) return textError(`Message not found: ${message_id} in ${chat_id}`);
  return json(msg);
};

export default handler;
