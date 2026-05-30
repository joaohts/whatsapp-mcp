import { intArg, json, requireStr, ToolHandler } from '../context';

const handler: ToolHandler = async (ctx, args) => {
  const query = requireStr(args, 'query');
  const maxChats = intArg(args, 'max_chats', 50, 1, 500);
  const limitPerChat = intArg(args, 'limit_per_chat', 10, 1, 100);
  return json(ctx.store.searchMessages(query, maxChats, limitPerChat));
};

export default handler;
