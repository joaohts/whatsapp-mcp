import { intArg, json, ToolHandler } from '../context';

const handler: ToolHandler = async (ctx, args) => {
  const limit = intArg(args, 'limit', 50, 1, 500);
  const offset = intArg(args, 'offset', 0, 0);
  return json(ctx.store.listChats(limit, offset));
};

export default handler;
