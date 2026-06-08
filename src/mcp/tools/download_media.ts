import {
  requireStr,
  textError,
  ToolContent,
  ToolHandler,
  ToolResult,
} from '../context';

// MCP context has practical size limits; warn (don't hard-fail) past this.
const SOFT_LIMIT_BYTES = 25 * 1024 * 1024;

const handler: ToolHandler = async (ctx, args) => {
  const chat_id = requireStr(args, 'chat_id');
  const message_id = requireStr(args, 'message_id');

  let result: { data: Buffer; mime: string; type: string } | null = null;

  if (ctx.daemon) {
    // Daemon owns the socket; delegate. The daemon already verified the
    // message exists and decrypted the bytes.
    result = await ctx.daemon.downloadMedia(chat_id, message_id);
    if (!result) {
      return textError(
        `Daemon could not download media for message ${message_id} in ${chat_id}.`,
      );
    }
  } else {
    if (!ctx.connection.isConnected()) {
      return textError(
        'Not connected to WhatsApp — cannot download media. Open the app to reconnect.',
      );
    }
    result = await ctx.connection.downloadMedia(chat_id, message_id);
    if (!result) {
      return textError(
        `No downloadable media found for message ${message_id} in ${chat_id}.`,
      );
    }
  }

  const { data, mime, type } = result;
  const base64 = data.toString('base64');
  const content: ToolContent[] = [];

  if (data.length > SOFT_LIMIT_BYTES) {
    content.push({
      type: 'text',
      text: `Warning: media is ${(data.length / (1024 * 1024)).toFixed(
        1,
      )} MB and may exceed the context limit.`,
    });
  }

  if (type === 'image' || type === 'sticker') {
    content.push({ type: 'image', data: base64, mimeType: mime });
  } else if (type === 'audio') {
    content.push({ type: 'audio', data: base64, mimeType: mime });
  } else {
    // video / document: no dedicated content type — embed as a resource blob.
    content.push({
      type: 'resource',
      resource: {
        uri: `whatsapp://${chat_id}/${message_id}`,
        mimeType: mime,
        blob: base64,
      },
    });
  }

  return { content };
};

export default handler;
