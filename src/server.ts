import { createRequire } from 'node:module';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { CalibreWebApi } from './api.js';
import type { Config } from './config.js';
import { registerBookTools } from './tools/books.js';
import { registerCoverTools } from './tools/covers.js';
import { registerShelfTools } from './tools/shelves.js';
import { registerStatsTools } from './tools/stats.js';

function packageVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require('../package.json') as { version: string };
    return pkg.version;
  } catch {
    return '0.0.0';
  }
}

export function createServer(config: Config): McpServer {
  const api = new CalibreWebApi(config);

  const server = new McpServer({
    name: 'calibreweb-mcp',
    version: packageVersion(),
  });

  // Every tool is read-only: the OPDS feed has no write surface, so there is
  // no read-only mode to configure and nothing destructive to confirm.
  registerBookTools(server, api);
  registerShelfTools(server, api);
  registerCoverTools(server, api);
  registerStatsTools(server, api);

  return server;
}
