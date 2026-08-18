import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { CalibreWebApi } from '../api.js';
import { jsonResult, run } from '../result.js';

export function registerStatsTools(
  server: McpServer,
  api: CalibreWebApi
): void {
  server.registerTool(
    'get_stats',
    {
      title: 'Get library statistics',
      description:
        'Returns the total number of books, authors, categories (tags) and ' +
        'series in the library.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () =>
      run(async () => {
        const raw = await api.getJson('/opds/stats');
        const stats =
          typeof raw === 'object' && raw !== null
            ? (raw as Record<string, unknown>)
            : {};
        // Only the four documented numeric counters are passed through — the
        // endpoint answer goes into the model context verbatim otherwise.
        const pick = (key: string): number | undefined =>
          typeof stats[key] === 'number' ? stats[key] : undefined;
        return jsonResult({
          books: pick('books'),
          authors: pick('authors'),
          categories: pick('categories'),
          series: pick('series'),
        });
      })
  );
}
