import { intArg, json, requireStr, textError, ToolHandler } from '../context';

const handler: ToolHandler = async (ctx, args) => {
  const chat_id = requireStr(args, 'chat_id');
  const count = intArg(args, 'count', 50, 1, 500);
  const before = args.before_timestamp;
  if (!ctx.connection.isConnected()) {
    return textError(
      'Not connected to WhatsApp — cannot fetch more history. Open the app to reconnect.',
    );
  }
  const result = await ctx.connection.fetchMoreHistory(
    chat_id,
    typeof before === 'number' ? before : undefined,
    count,
  );
  return json(result);
};

export default handler;
