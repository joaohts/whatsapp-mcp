import { json, ToolHandler } from '../context';

// `refresh` is accepted for forward-compat but currently a no-op: Baileys has
// no cheap "fetch all contacts" call, and contacts stream in via events. We
// return the local store, which is kept current by the live connection.
const handler: ToolHandler = async (ctx) => {
  return json(ctx.store.listContacts());
};

export default handler;
