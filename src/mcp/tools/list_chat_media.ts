import { intArg, json, requireStr, strArg, ToolHandler } from '../context';

const handler: ToolHandler = async (ctx, args) => {
  const chat_id = requireStr(args, 'chat_id');
  const type = strArg(args, 'type');
  const limit = intArg(args, 'limit', 50, 1, 500);
  const offset = intArg(args, 'offset', 0, 0);
  return json(ctx.store.listChatMedia(chat_id, type, limit, offset));
};

export default handler;
