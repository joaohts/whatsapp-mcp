import { intArg, json, requireStr, ToolHandler } from '../context';

const handler: ToolHandler = async (ctx, args) => {
  const query = requireStr(args, 'query');
  const limit = intArg(args, 'limit', 50, 1, 500);
  return json(ctx.store.searchContacts(query, limit));
};

export default handler;
