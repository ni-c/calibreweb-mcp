import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';

import type { CalibreWebApi } from '../api.js';
import { READ_ONLY } from './annotations.js';
import { jsonResult, run } from '../result.js';
import { Notes, shapeFeed } from '../shape.js';

export function registerShelfTools(
  server: McpServer,
  api: CalibreWebApi
): void {
  server.registerTool(
    'list_shelves',
    {
      title: 'List shelves',
      description:
        'Lists the shelves visible to the configured user: every public shelf ' +
        'plus the user’s own private ones. Use the returned id with ' +
        'get_shelf_books. isPublic is only reported on English-locale instances ' +
        '(Calibre-Web marks public shelves with a localized title suffix).',
      inputSchema: z.object({
        offset: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe(
            'Pagination offset; use pagination.nextOffset from the previous call'
          ),
      }),
      annotations: READ_ONLY,
    },
    async ({ offset }) =>
      run(async () => {
        const notes = new Notes();
        const parsed = await api.getFeed(
          '/opds/shelfindex',
          offset === undefined || offset === 0 ? undefined : { offset }
        );
        const shaped = shapeFeed(parsed, api.url, offset ?? 0, notes);
        return jsonResult({
          shelves: shaped.navItems,
          pagination: shaped.pagination,
          notes: notes.list(),
        });
      })
  );

  server.registerTool(
    'get_shelf_books',
    {
      title: 'List books on a shelf',
      description:
        'Lists the books on a shelf, in the shelf’s own order. Shelf ids ' +
        'come from list_shelves. Book entries include per-format download URLs ' +
        'and a cover URL; fetch the cover image itself with get_cover.',
      inputSchema: z.object({
        shelf_id: z
          .number()
          .int()
          .positive()
          .max(2_147_483_647)
          .describe('Numeric shelf id from list_shelves'),
        offset: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe(
            'Pagination offset; use pagination.nextOffset from the previous call'
          ),
      }),
      annotations: READ_ONLY,
    },
    async ({ shelf_id, offset }) =>
      run(async () => {
        const notes = new Notes();
        const parsed = await api.getFeed(
          `/opds/shelf/${shelf_id}`,
          offset === undefined || offset === 0 ? undefined : { offset }
        );
        const shaped = shapeFeed(parsed, api.url, offset ?? 0, notes);
        if (shaped.books.length === 0) {
          notes.add(
            'An empty result can also mean the shelf does not exist or is not accessible to the configured user — Calibre-Web returns an empty feed in that case.'
          );
        }
        return jsonResult({
          shelfId: shelf_id,
          books: shaped.books,
          pagination: shaped.pagination,
          notes: notes.list(),
        });
      })
  );
}
