import { boolArg, intArg, json, requireStr, ToolHandler } from '../context';

const handler: ToolHandler = async (ctx, args) => {
  const chat_id = requireStr(args, 'chat_id');
  const limit = intArg(args, 'limit', 50, 1, 500);
  const before = args.before_timestamp;
  const after = args.after_timestamp;
  return json(
    ctx.store.getChatMessages({
      chat_id,
      limit,
      before_timestamp: typeof before === 'number' ? before : undefined,
      after_timestamp: typeof after === 'number' ? after : undefined,
      from_me: boolArg(args, 'from_me'),
    }),
  );
};

export default handler;
