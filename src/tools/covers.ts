import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';

import type { CalibreWebApi } from '../api.js';
import { READ_ONLY } from './annotations.js';
import { errorResult, run } from '../result.js';

/**
 * Only image types MCP clients render are passed through. Anything else — an
 * HTML error page a proxy served with 200, an SVG with active content — must
 * not reach the client as an "image".
 */
const IMAGE_TYPE_ALLOWLIST = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

export function registerCoverTools(
  server: McpServer,
  api: CalibreWebApi
): void {
  server.registerTool(
    'get_cover',
    {
      title: 'Get a book cover',
      description:
        'Fetches the cover of a book and returns it as an image. Book ids come ' +
        'from the other tools (books with id null have no cover). Calibre-Web ' +
        'serves the full-size cover; images over 1 MB are refused to protect ' +
        'the context window — use the coverUrl from the book entry instead.',
      inputSchema: z.object({
        book_id: z
          .number()
          .int()
          .positive()
          .max(2_147_483_647)
          .describe(
            'Numeric book id from search_books, list_books or get_shelf_books'
          ),
      }),
      annotations: READ_ONLY,
    },
    async ({ book_id }) =>
      run(async () => {
        const { data, contentType } = await api.getBinary(
          `/opds/cover/${book_id}`
        );
        const mimeType = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
        if (!IMAGE_TYPE_ALLOWLIST.has(mimeType)) {
          // The header value is upstream-controlled: echo it only when it looks
          // like a media type, never verbatim.
          const shown = /^[a-z0-9.+-]{1,64}\/[a-z0-9.+-]{1,64}$/.test(mimeType)
            ? mimeType
            : 'unknown';
          return errorResult(
            `Calibre-Web returned content of type "${shown}" for the cover of book ${book_id}; ` +
              'expected a JPEG, PNG, GIF or WebP image. The book may have no cover.'
          );
        }
        return {
          content: [
            {
              type: 'image',
              data: data.toString('base64'),
              mimeType,
            },
          ],
        };
      })
  );
}
