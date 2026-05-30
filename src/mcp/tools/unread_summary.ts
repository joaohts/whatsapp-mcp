import { json, ToolHandler } from '../context';

const handler: ToolHandler = async (ctx) => {
  return json(ctx.store.unreadSummary());
};

export default handler;
