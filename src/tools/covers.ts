import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';

import type { CalibreWebApi } from '../api.js';
import { READ_ONLY } from './annotations.js';
import { errorResult, run } from '../result.js';

/**
 * The image types this server will hand to a client, and how each one starts.
 *
 * The type is decided by the **bytes**, not by the `Content-Type` header, and
 * the header is not even consulted. Two reasons, and the second is why this is
 * not merely defence in depth:
 *
 * - The header is chosen by whatever answered the request. A reverse proxy or
 *   a WAF that serves an HTML login page with `image/png` on it would
 *   otherwise reach the client as an image, and an SVG — which is a document
 *   with script in it, not a picture — would reach it as one too.
 * - The header is not evidence about the file anyway. Calibre stores every
 *   cover as `cover.jpg` whatever the image really is, and Calibre-Web serves
 *   it with `send_from_directory`, so Flask guesses `image/jpeg` from that
 *   filename; the Google Drive branch hard-codes `image/jpeg` outright. A PNG
 *   announced as a JPEG is the normal case in a real library — the integration
 *   suite's own fixtures are PNG files named `cover.jpg` — so a check that the
 *   two agree would refuse legitimate covers while still trusting a header for
 *   the case that matters.
 *
 * Reading the signature answers both: an HTML page matches nothing and is
 * refused, and a PNG under a JPEG header is reported as the PNG it is.
 */
const SIGNATURES: {
  mimeType: CoverType;
  matches: (data: Buffer) => boolean;
}[] = [
  {
    mimeType: 'image/jpeg',
    matches: (d) =>
      d.length >= 3 && d[0] === 0xff && d[1] === 0xd8 && d[2] === 0xff,
  },
  {
    mimeType: 'image/png',
    matches: (d) =>
      d.length >= 8 &&
      d
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    mimeType: 'image/gif',
    matches: (d) =>
      d.length >= 6 &&
      (d.subarray(0, 6).toString('latin1') === 'GIF87a' ||
        d.subarray(0, 6).toString('latin1') === 'GIF89a'),
  },
  {
    mimeType: 'image/webp',
    matches: (d) =>
      d.length >= 12 &&
      d.subarray(0, 4).toString('latin1') === 'RIFF' &&
      d.subarray(8, 12).toString('latin1') === 'WEBP',
  },
];

type CoverType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

/** The type the payload actually is, or undefined for anything else. */
function sniff(data: Buffer): CoverType | undefined {
  return SIGNATURES.find((signature) => signature.matches(data))?.mimeType;
}

/**
 * The announced type, for the error message only — never for the decision, and
 * only when it has the shape of a media type. It is upstream text.
 */
function announced(contentType: string): string {
  const value = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  return /^[a-z0-9.+-]{1,64}\/[a-z0-9.+-]{1,64}$/.test(value)
    ? value
    : 'an unreadable type';
}

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
        'the context window — use the coverUrl from the book entry instead. ' +
        'The reported mimeType is read from the image data, not from the ' +
        'response header: Calibre names every cover file cover.jpg whatever ' +
        'the image really is. Anything that is not a JPEG, PNG, GIF or WebP ' +
        'is refused rather than passed on as an image.',
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
      // The image stays in `content`, where a client renders it; the schema
      // describes it rather than repeating it. Base64 in `structuredContent`
      // as well would double a payload that is already the largest thing this
      // server returns, for a copy nothing would read.
      outputSchema: z.object({
        bookId: z.number().int(),
        mimeType: z
          .enum(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])
          .describe('Of the image in the content block.'),
        bytes: z.number().int().describe('Size of the decoded image.'),
      }),
    },
    async ({ book_id }) =>
      run(async () => {
        const { data, contentType } = await api.getBinary(
          `/opds/cover/${book_id}`
        );
        const mimeType = sniff(data);
        if (mimeType === undefined) {
          return errorResult(
            `Calibre-Web answered the cover of book ${book_id} with ${announced(contentType)}, ` +
              'and the data is not a JPEG, PNG, GIF or WebP image. It was ' +
              'refused rather than passed on as one — the book may have no ' +
              'cover, or something in front of Calibre-Web answered instead.'
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
          structuredContent: {
            bookId: book_id,
            mimeType,
            bytes: data.length,
          },
        };
      })
  );
}
