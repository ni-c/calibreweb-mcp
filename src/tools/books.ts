import { z } from 'zod';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { CalibreWebApi } from '../api.js';
import { jsonResult, run, ToolInputError } from '../result.js';
import { Notes, shapeFeed } from '../shape.js';

const SEARCH_DEFAULT_LIMIT = 50;
const SEARCH_MAX_LIMIT = 200;

const VIEW_ROUTES: Record<string, string> = {
  new: '/opds/new',
  hot: '/opds/hot',
  rated: '/opds/rated',
  discover: '/opds/discover',
  read: '/opds/readbooks',
  unread: '/opds/unreadbooks',
};

export function registerBookTools(server: McpServer, api: CalibreWebApi): void {
  server.registerTool(
    'search_books',
    {
      title: 'Search books',
      description:
        'Searches the library by title, author, series, publisher and tags. ' +
        'Calibre-Web returns every match in a single response, so broad queries ' +
        'on a large library are truncated client-side — totalFound reports the ' +
        'real match count. Book entries include per-format download URLs and a ' +
        'cover URL; fetch the cover image itself with get_cover.',
      inputSchema: {
        query: z.string().min(1).max(500).describe('Search term'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(SEARCH_MAX_LIMIT)
          .optional()
          .describe(
            `Maximum number of books to return (default ${SEARCH_DEFAULT_LIMIT}, max ${SEARCH_MAX_LIMIT})`
          ),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ query, limit }) =>
      run(async () => {
        const max = limit ?? SEARCH_DEFAULT_LIMIT;
        const notes = new Notes();
        const parsed = await api.getFeed('/opds/search', { query });
        const { books } = shapeFeed(parsed, api.url, 0, notes);
        const truncated = books.length > max;
        if (truncated) {
          notes.add(
            `The search matched ${books.length} books; only the first ${max} are shown. Narrow the query or raise the limit parameter.`
          );
        }
        return jsonResult({
          totalFound: books.length,
          truncated,
          books: books.slice(0, max),
          notes: notes.list(),
        });
      })
  );

  server.registerTool(
    'list_books',
    {
      title: 'List books',
      description:
        'Lists books from one of the Calibre-Web views: new (recently added, ' +
        'default), hot (most downloaded), rated (best rated), discover (random ' +
        'selection), read / unread (per-user reading state), or all (the full ' +
        'library ordered by title, optionally narrowed to titles starting with ' +
        'a letter). Page size is a server-side setting; pass the returned ' +
        'pagination.nextOffset as offset to fetch the next page. The discover ' +
        'view is random and not paginated.',
      inputSchema: {
        view: z
          .enum(['new', 'hot', 'rated', 'discover', 'read', 'unread', 'all'])
          .optional()
          .describe('Which view to list (default: new)'),
        letter: z
          .string()
          .optional()
          .describe(
            'Only with view "all": a single initial letter or digit, or "00" for every title (default: "00")'
          ),
        offset: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe(
            'Pagination offset; use pagination.nextOffset from the previous call'
          ),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ view, letter, offset }) =>
      run(async () => {
        const selected = view ?? 'new';
        if (letter !== undefined && selected !== 'all') {
          throw new ToolInputError(
            'The letter parameter is only supported with view "all".'
          );
        }

        let path: string;
        if (selected === 'all') {
          path = `/opds/books/letter/${assertLetter(letter ?? '00')}`;
        } else {
          path = VIEW_ROUTES[selected] as string;
        }

        // The discover feed is a random selection without pagination.
        const params =
          selected === 'discover' || offset === undefined || offset === 0
            ? undefined
            : { offset };

        const notes = new Notes();
        const parsed = await api.getFeed(path, params);
        const shaped = shapeFeed(parsed, api.url, offset ?? 0, notes);
        return jsonResult({
          view: selected,
          books: shaped.books,
          pagination: shaped.pagination,
          notes: notes.list(),
        });
      })
  );
}

/**
 * Guards the letter path segment of the `all` view: a single letter or digit
 * (Calibre-Web groups titles by uppercased first character) or the literal
 * `00` for "everything".
 */
function assertLetter(letter: string): string {
  const upper = letter.toUpperCase();
  if (upper !== '00' && !/^[\p{L}\p{N}]$/u.test(upper)) {
    throw new ToolInputError(
      'invalid letter: use a single letter or digit, or "00" for all titles'
    );
  }
  return encodeURIComponent(upper);
}
