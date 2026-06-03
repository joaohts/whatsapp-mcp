// MUST be imported before any backend/* module. Sets WHATSAPP_MCP_HOME to
// the CLI variant's root so backend/paths.ts directs all state under
// ~/.whatsapp-mcp/ instead of the DMG variant's ~/Library/Application Support/.
//
// Pure side-effect module — exports nothing. Import order matters.

import { homedir } from 'os';
import { join } from 'path';

const CLI_HOME = process.env.WHATSAPP_MCP_HOME ?? join(homedir(), '.whatsapp-mcp');
process.env.WHATSAPP_MCP_HOME = CLI_HOME;

export const cliHome = CLI_HOME;
