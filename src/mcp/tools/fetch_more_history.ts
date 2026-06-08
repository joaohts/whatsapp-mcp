import { intArg, json, requireStr, textError, ToolHandler } from '../context';

const handler: ToolHandler = async (ctx, args) => {
  const chat_id = requireStr(args, 'chat_id');
  const count = intArg(args, 'count', 50, 1, 500);
  const before = args.before_timestamp;
  const before_ts = typeof before === 'number' ? before : undefined;

  // If a daemon owns the Baileys socket, delegate. The local `connection` is
  // intentionally not started in that case.
  if (ctx.daemon) {
    const result = await ctx.daemon.fetchHistory(chat_id, before_ts, count);
    if (!result) {
      return textError(
        'Daemon could not fetch more history (daemon configured but unreachable or returned an error).',
      );
    }
    return json(result);
  }

  if (!ctx.connection.isConnected()) {
    return textError(
      'Not connected to WhatsApp — cannot fetch more history. Open the app to reconnect.',
    );
  }
  const result = await ctx.connection.fetchMoreHistory(chat_id, before_ts, count);
  return json(result);
};

export default handler;
