import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/server';
import { buildToolFilter, installToolFilter } from 'mcp-tool-allowlist';

import { ALL_TOOLS, ESSENTIAL_TOOLS } from './tools/catalogue.js';

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
  // Before anything is built: an unusable tool list should fail on the
  // way in, not leave a server running with tools quietly missing.
  const filter = buildToolFilter({
    allowTools: config.allowTools,
    denyTools: config.denyTools,
    catalogue: {
      all: ALL_TOOLS,
      essential: ESSENTIAL_TOOLS,
    },
    names: {
      allow: 'CALIBRE_WEB_ALLOW_TOOLS',
      deny: 'CALIBRE_WEB_DENY_TOOLS',
      server: 'calibreweb-mcp',
    },
  });

  const api = new CalibreWebApi(config);

  const server = new McpServer({
    name: 'calibreweb-mcp',
    version: packageVersion(),
  });

  // Wraps server.registerTool, so it has to sit before the first
  // register call and does not care how they are organised.
  installToolFilter(server, filter);

  // Every tool is read-only: the OPDS feed has no write surface, so there is
  // no read-only mode to configure and nothing destructive to confirm.
  registerBookTools(server, api);
  registerShelfTools(server, api);
  registerCoverTools(server, api);
  registerStatsTools(server, api);

  return server;
}
