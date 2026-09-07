import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CallToolResult } from '@modelcontextprotocol/server';

import { loadConfig } from '../src/config.js';
import { jsonResult } from '../src/result.js';
import {
  MAX_FIELD_CHARS,
  Notes,
  decodeXmlText,
  nextOffsetFromLinks,
  parseContentBlob,
  shapeFeed,
} from '../src/shape.js';
import {
  bookEntryXml,
  connect,
  feedXml,
  navEntryXml,
  stubCalibreWeb,
} from './helpers.js';

function firstText(result: CallToolResult): string {
  const block = result.content[0];
  return block?.type === 'text' ? block.text : '';
}

function structured(result: CallToolResult): Record<string, unknown> {
  return result.structuredContent as Record<string, unknown>;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/**
 * An id from the feed reaches an output schema that promises a number, and a
 * digit run read whole does not stay one.
 *
 * `Number('9'.repeat(400))` is `Infinity` and `Number('9'.repeat(20))` is
 * `1e20`. Zod refuses the first for `z.number()` and the second for
 * `z.number().int()`, and the SDK answers a schema violation with an error for
 * the *whole* call — so one entry in a page of fifty took the listing down,
 * with a message naming no cause. `get_cover` and `get_shelf_books` would have
 * refused both anyway.
 */
describe('ids the feed chose cannot break the listing', () => {
  it('reports an oversized cover id as no id, and still answers', async () => {
    const huge = '9'.repeat(400);
    stubCalibreWeb({
      '/opds/new': {
        body: feedXml([
          `  <entry>
    <title>Poisoned</title>
    <id>urn:uuid:x</id>
    <link type="image/jpeg" href="/opds/cover/${huge}" rel="http://opds-spec.org/image"/>
  </entry>`,
          bookEntryXml({ id: 7, title: 'Fine' }),
        ]),
      },
    });
    const client = await connect();
    const result = (await client.callTool({
      name: 'list_books',
      arguments: {},
    })) as CallToolResult;

    expect(result.isError).toBeFalsy();
    const books = structured(result).books as { id: number | null }[];
    expect(books).toHaveLength(2);
    expect(books[0]!.id).toBeNull();
    expect(books[1]!.id).toBe(7);
    expect((structured(result).notes as string[]).join(' ')).toContain(
      'not usable numeric ids'
    );
  });

  it('reports a twenty-digit id as no id', async () => {
    stubCalibreWeb({
      '/opds/new': {
        body: feedXml([
          `  <entry>
    <title>Big</title>
    <id>urn:uuid:x</id>
    <link type="image/jpeg" href="/opds/cover/99999999999999999999" rel="http://opds-spec.org/image"/>
  </entry>`,
        ]),
      },
    });
    const client = await connect();
    const result = (await client.callTool({
      name: 'list_books',
      arguments: {},
    })) as CallToolResult;
    expect(result.isError).toBeFalsy();
    expect(
      (structured(result).books as { id: number | null }[])[0]!.id
    ).toBeNull();
  });

  it('reports an unusable shelf id as no id, and still answers', async () => {
    stubCalibreWeb({
      '/opds/shelfindex': {
        body: feedXml([
          navEntryXml('Poisoned', `/opds/shelf/${'9'.repeat(400)}`),
          navEntryXml('Fine', '/opds/shelf/3'),
        ]),
      },
    });
    const client = await connect();
    const result = (await client.callTool({
      name: 'list_shelves',
      arguments: {},
    })) as CallToolResult;
    expect(result.isError).toBeFalsy();
    const shelves = structured(result).shelves as { id: number | null }[];
    expect(shelves[0]!.id).toBeNull();
    expect(shelves[1]!.id).toBe(3);
  });

  it('stops paginating rather than offering an unusable next offset', () => {
    const warnings = new Notes();
    const offset = nextOffsetFromLinks(
      [{ '@_rel': 'next', '@_href': `/opds/new?offset=${'9'.repeat(400)}` }],
      warnings
    );
    expect(offset).toBeUndefined();
    expect(warnings.list().join(' ')).toContain('cannot use');
  });

  it('carries an unusable next offset through the tool as hasMore false', async () => {
    stubCalibreWeb({
      '/opds/new': {
        body: feedXml([bookEntryXml()], {
          nextHref: `/opds/new?offset=${'9'.repeat(400)}`,
        }),
      },
    });
    const client = await connect();
    const result = (await client.callTool({
      name: 'list_books',
      arguments: {},
    })) as CallToolResult;
    expect(result.isError).toBeFalsy();
    expect(structured(result).pagination).toEqual({
      offset: 0,
      hasMore: false,
    });
  });

  it('drops a counter that is not a finite number', async () => {
    stubCalibreWeb({
      '/opds/stats': {
        // 1e999 parses to Infinity, which `typeof` calls a number and
        // `z.number()` refuses.
        body: '{"books": 1e999, "authors": 5, "categories": -0, "series": null}',
        contentType: 'application/json',
      },
    });
    const client = await connect();
    const result = (await client.callTool({
      name: 'get_stats',
      arguments: {},
    })) as CallToolResult;
    expect(result.isError).toBeFalsy();
    expect(structured(result)).toEqual({ authors: 5, categories: 0 });
    expect(Object.is(structured(result).categories, -0)).toBe(false);
  });
});

/**
 * A lone surrogate is not a character, and nothing in the language says so.
 *
 * `String.fromCodePoint(0xd800)` returns half a pair without complaining, and
 * `slice` at a character budget can cut a pair in two. Either way the string
 * is legal JSON on the wire and raises `UnicodeEncodeError` in a client that
 * encodes it to UTF-8.
 */
describe('nothing leaves with half a character', () => {
  it('decodes a surrogate character reference to the replacement character', () => {
    const decoded = decodeXmlText('a&#xD800;b');
    expect(decoded.isWellFormed()).toBe(true);
    expect(decoded).toBe(`a${String.fromCodePoint(0xfffd)}b`);
  });

  it('decodes the decimal spelling the same way', () => {
    expect(decodeXmlText('a&#55296;b').isWellFormed()).toBe(true);
  });

  it('keeps a summary well-formed when the cut lands inside a pair', () => {
    const emoji = String.fromCodePoint(0x1f600);
    const body = 'x'.repeat(999) + emoji.repeat(50);
    const { summary } = parseContentBlob(body, { left: 30_000 });
    expect(summary).toBeDefined();
    expect(summary!.isWellFormed()).toBe(true);
  });

  it('keeps a truncated field well-formed', () => {
    const emoji = String.fromCodePoint(0x1f600);
    const warnings = new Notes();
    const parsed = {
      feed: {
        entry: [
          {
            title: 'x'.repeat(MAX_FIELD_CHARS - 1) + emoji.repeat(20),
            id: 'urn:uuid:x',
            link: [
              {
                '@_rel': 'http://opds-spec.org/image',
                '@_href': '/opds/cover/1',
              },
            ],
          },
        ],
      },
    };
    const { books } = shapeFeed(
      parsed,
      'https://books.example.net',
      0,
      warnings
    );
    expect(books[0]!.title.isWellFormed()).toBe(true);
  });
});

/**
 * A field the library chose cannot make the tool unanswerable.
 *
 * The result ceiling drops summaries and then refuses; a megabyte title is not
 * a summary, so every listing that paged over that book answered with "narrow
 * the request" and no narrowing helped.
 */
describe('one entry cannot take the listing with it', () => {
  it('truncates a huge title and says so', async () => {
    stubCalibreWeb({
      '/opds/new': {
        body: feedXml([bookEntryXml({ title: 'T'.repeat(1_000_000) })]),
      },
    });
    const client = await connect();
    const result = (await client.callTool({
      name: 'list_books',
      arguments: {},
    })) as CallToolResult;
    expect(result.isError).toBeFalsy();
    const books = structured(result).books as { title: string }[];
    expect(books[0]!.title.length).toBeLessThanOrEqual(MAX_FIELD_CHARS + 1);
    expect((structured(result).notes as string[]).join(' ')).toContain(
      'were truncated'
    );
  });

  it('caps how many tags one entry contributes', async () => {
    const tags = Array.from({ length: 300 }, (_, i) => `tag${i}`);
    stubCalibreWeb({
      '/opds/new': { body: feedXml([bookEntryXml({ tags })]) },
    });
    const client = await connect();
    const result = (await client.callTool({
      name: 'list_books',
      arguments: {},
    })) as CallToolResult;
    const books = structured(result).books as { tags: string[] }[];
    expect(books[0]!.tags).toHaveLength(100);
    expect((structured(result).notes as string[]).join(' ')).toContain(
      'extras were dropped'
    );
  });

  it('drops a link longer than any usable URL', async () => {
    stubCalibreWeb({
      '/opds/new': {
        body: feedXml([
          `  <entry>
    <title>Long link</title>
    <id>urn:uuid:x</id>
    <link type="image/jpeg" href="/opds/cover/1?x=${'a'.repeat(3000)}" rel="http://opds-spec.org/image"/>
  </entry>`,
        ]),
      },
    });
    const client = await connect();
    const result = (await client.callTool({
      name: 'list_books',
      arguments: {},
    })) as CallToolResult;
    const books = structured(result).books as { coverUrl?: string }[];
    expect(books[0]!.coverUrl).toBeUndefined();
  });
});

/**
 * The budget has to measure the string that is sent.
 *
 * It measured `JSON.stringify(data)` and sent `JSON.stringify(data, null, 2)`,
 * which is two to three times as many characters — so the ceiling held for a
 * string nobody ever received.
 */
describe('the result ceiling measures what goes out', () => {
  it('holds for the text block as emitted', () => {
    const books = Array.from({ length: 4000 }, (_, i) => ({
      id: i,
      title: 't'.repeat(60),
    }));
    let text: string;
    try {
      text = firstText(jsonResult({ books }));
    } catch {
      // Refusing is the other legitimate answer at this size; what must not
      // happen is an answer that is over the ceiling.
      return;
    }
    expect(text.length).toBeLessThanOrEqual(400_000);
  });

  it('keeps a giant feed answer under the ceiling as emitted', async () => {
    const entries = Array.from({ length: 200 }, (_, i) =>
      bookEntryXml({ id: i + 1, title: `Book ${i}`, comment: 'c'.repeat(2000) })
    );
    stubCalibreWeb({ '/opds/search': { body: feedXml(entries) } });
    const client = await connect();
    const result = (await client.callTool({
      name: 'search_books',
      arguments: { query: 'x', limit: 200 },
    })) as CallToolResult;
    expect(firstText(result).length).toBeLessThanOrEqual(400_000);
  });
});

/**
 * The status is the answer; the body is a quotation.
 *
 * Reading the body under the success ceiling first made a 401 behind a proxy
 * that answers with a login page report itself as "larger than … and was
 * refused" — the size instead of the status, and none of the 401 handling ran.
 */
describe('status before body', () => {
  it('reports a 401 with a two-megabyte login page as a 401', async () => {
    stubCalibreWeb({
      '/opds/cover/1': {
        body: `<html><body>${'x'.repeat(2 * 1024 * 1024)}</body></html>`,
        status: 401,
        contentType: 'text/html',
      },
    });
    const client = await connect();
    const result = (await client.callTool({
      name: 'get_cover',
      arguments: { book_id: 1 },
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    const text = firstText(result);
    expect(text).toContain('HTTP 401');
    expect(text).toContain('CALIBRE_WEB_USERNAME');
    expect(text).not.toContain('larger than');
  });

  it('reports an oversized 500 page as a 500', async () => {
    stubCalibreWeb({
      '/opds/new': { body: 'e'.repeat(9 * 1024 * 1024), status: 500 },
    });
    const client = await connect();
    const result = (await client.callTool({
      name: 'list_books',
      arguments: {},
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain('HTTP 500');
  });

  it('labels an upstream error body and cuts it to 200 characters', async () => {
    stubCalibreWeb({
      '/opds/stats': { body: 'e'.repeat(5000), status: 503 },
    });
    const client = await connect();
    const result = (await client.callTool({
      name: 'get_stats',
      arguments: {},
    })) as CallToolResult;
    const text = firstText(result);
    expect(text).toContain('(untrusted text from the instance)');
    expect(text).toContain('(truncated)');
    expect(text.length).toBeLessThan(500);
  });
});

/**
 * A refused login is remembered for ten seconds.
 *
 * Calibre-Web logs every refused OPDS login at warning level — the line
 * fail2ban filters on — and the rate limiter in `verify_password` is commented
 * out, with no limiter on the OPDS routes. Every tool here is annotated
 * read-only, idempotent and cheap, which is what a model retries after being
 * told to check the credentials.
 */
describe('a refused login is not retried immediately', () => {
  it('repeats the refusal from memory without a request', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const stub = stubCalibreWeb({
      '/opds/new': { body: 'Unauthorized', status: 401 },
      '/opds/hot': { body: 'Unauthorized', status: 401 },
    });
    const client = await connect();

    const first = (await client.callTool({
      name: 'list_books',
      arguments: {},
    })) as CallToolResult;
    expect(first.isError).toBe(true);
    expect(stub.calls).toHaveLength(1);

    const second = (await client.callTool({
      name: 'list_books',
      arguments: { view: 'hot' },
    })) as CallToolResult;
    expect(second.isError).toBe(true);
    expect(stub.calls).toHaveLength(1);
    const text = firstText(second);
    expect(text).toContain('Repeated from memory');
    expect(text).toContain('HTTP 401');
    expect(text).toContain('CALIBRE_WEB_USERNAME');
  });

  it('tries again once the window has passed', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const stub = stubCalibreWeb({
      '/opds/new': { body: 'Unauthorized', status: 401 },
    });
    const client = await connect();
    await client.callTool({ name: 'list_books', arguments: {} });
    vi.setSystemTime(new Date(Date.now() + 11_000));
    await client.callTool({ name: 'list_books', arguments: {} });
    expect(stub.calls).toHaveLength(2);
  });

  it('does not remember any other status', async () => {
    const stub = stubCalibreWeb({
      '/opds/new': { body: 'Server error', status: 500 },
    });
    const client = await connect();
    await client.callTool({ name: 'list_books', arguments: {} });
    await client.callTool({ name: 'list_books', arguments: {} });
    expect(stub.calls).toHaveLength(2);
  });
});

/** The cover is an image because its bytes say so, not because a header does. */
describe('the cover type is read from the data', () => {
  it('refuses an HTML page announced as a PNG', async () => {
    stubCalibreWeb({
      '/opds/cover/1': {
        body: '<html><body>Login please</body></html>',
        contentType: 'image/png',
      },
    });
    const client = await connect();
    const result = (await client.callTool({
      name: 'get_cover',
      arguments: { book_id: 1 },
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain('not a JPEG, PNG, GIF or WebP image');
    expect(firstText(result)).not.toContain('Login please');
  });

  it('refuses an SVG, whatever it is announced as', async () => {
    stubCalibreWeb({
      '/opds/cover/1': {
        body: '<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>',
        contentType: 'image/jpeg',
      },
    });
    const client = await connect();
    const result = (await client.callTool({
      name: 'get_cover',
      arguments: { book_id: 1 },
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(firstText(result)).not.toContain('<script>');
  });

  it('reports a PNG as a PNG even when the header says JPEG', async () => {
    // What a real library does: Calibre names every cover `cover.jpg`
    // whatever the image is, and Calibre-Web's `send_from_directory` guesses
    // the type from that name. The integration fixtures are PNG files under
    // that name, which is how this was found.
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(24, 0x11),
    ]);
    stubCalibreWeb({
      '/opds/cover/1': { body: png, contentType: 'image/jpeg' },
    });
    const client = await connect();
    const result = (await client.callTool({
      name: 'get_cover',
      arguments: { book_id: 1 },
    })) as CallToolResult;
    expect(result.isError).toBeFalsy();
    const block = result.content[0]!;
    expect(block.type).toBe('image');
    if (block.type === 'image') expect(block.mimeType).toBe('image/png');
    expect(structured(result).mimeType).toBe('image/png');
  });

  it('accepts a real PNG', async () => {
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(24, 0x11),
    ]);
    stubCalibreWeb({
      '/opds/cover/1': { body: png, contentType: 'image/png' },
    });
    const client = await connect();
    const result = (await client.callTool({
      name: 'get_cover',
      arguments: { book_id: 1 },
    })) as CallToolResult;
    expect(result.isError).toBeFalsy();
    expect(result.content[0]!.type).toBe('image');
  });
});

/** Four counters do not need the eight-megabyte feed ceiling. */
describe('the stats endpoint has its own ceiling', () => {
  it('refuses a stats body past 64 KiB', async () => {
    stubCalibreWeb({
      '/opds/stats': {
        body: `{"books": 1, "padding": "${'x'.repeat(100_000)}"}`,
        contentType: 'application/json',
      },
    });
    const client = await connect();
    const result = (await client.callTool({
      name: 'get_stats',
      arguments: {},
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain('larger than');
  });
});

/** A configuration value is described, not echoed. */
describe('startup diagnostics never print the value', () => {
  it('does not print a password pasted into the URL variable', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation((): never => {
      throw new Error('exit');
    });
    const secret = 'hunter2-correct-horse-battery-staple';
    expect(() => loadConfig({ CALIBRE_WEB_URL: secret })).toThrow('exit');
    const output = error.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).not.toContain(secret);
    expect(output).toContain('does not look like a URL');
  });

  it('does not print a key whose colon makes it a scheme', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation((): never => {
      throw new Error('exit');
    });
    const key = 'a'.repeat(56);
    expect(() => loadConfig({ CALIBRE_WEB_URL: `${key}:x` })).toThrow('exit');
    const output = error.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).not.toContain(key);
    expect(output).toContain('must use http:// or https://');
  });
});

/** The base URL is stored as what it means, not as what was typed. */
describe('the configured URL is stored parsed', () => {
  it('drops a query string and a fragment, and says so', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const config = loadConfig({
      CALIBRE_WEB_URL: 'https://books.example.net/calibre/?debug=1#top',
      CALIBRE_WEB_USERNAME: 'u',
      CALIBRE_WEB_PASSWORD: 'p',
    });
    expect(config.url).toBe('https://books.example.net/calibre');
    expect(error.mock.calls.map((c) => c.join(' ')).join('\n')).toContain(
      'query string or fragment'
    );
  });

  it('keeps a subpath install intact', () => {
    const config = loadConfig({
      CALIBRE_WEB_URL: 'https://books.example.net/calibre',
      CALIBRE_WEB_USERNAME: 'u',
      CALIBRE_WEB_PASSWORD: 'p',
    });
    expect(config.url).toBe('https://books.example.net/calibre');
  });
});

/** The branches the fixes added, at the edges the fixtures do not reach. */
describe('edges of the new boundaries', () => {
  it('recognises a GIF and a WebP by their signatures', async () => {
    const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(16, 0x11)]);
    const webp = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.alloc(4, 0x22),
      Buffer.from('WEBP'),
      Buffer.alloc(16, 0x11),
    ]);
    for (const [payload, expected] of [
      [gif, 'image/gif'],
      [webp, 'image/webp'],
    ] as const) {
      stubCalibreWeb({
        '/opds/cover/1': { body: payload, contentType: 'application/xml' },
      });
      const client = await connect();
      const result = (await client.callTool({
        name: 'get_cover',
        arguments: { book_id: 1 },
      })) as CallToolResult;
      expect(structured(result).mimeType).toBe(expected);
      vi.restoreAllMocks();
    }
  });

  it('describes an unreadable content type without quoting it', async () => {
    stubCalibreWeb({
      '/opds/cover/1': {
        body: 'not an image',
        contentType: 'nonsense header value',
      },
    });
    const client = await connect();
    const result = (await client.callTool({
      name: 'get_cover',
      arguments: { book_id: 1 },
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain('an unreadable type');
    expect(firstText(result)).not.toContain('nonsense header value');
  });

  it('answers the status even when the error body cannot be read', async () => {
    // A body that throws on read is still a 404 — the reader swallows the
    // failure rather than replacing the status with it.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      status: 404,
      ok: false,
      headers: new Headers(),
      body: {
        getReader: () => ({
          read: () => Promise.reject(new Error('broken pipe')),
          cancel: () => Promise.resolve(),
        }),
      },
      arrayBuffer: () => Promise.reject(new Error('broken pipe')),
    } as unknown as Response);
    const client = await connect();
    const result = (await client.callTool({
      name: 'list_books',
      arguments: {},
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    const text = firstText(result);
    expect(text).toContain('HTTP 404');
    expect(text).toContain('CALIBRE_WEB_URL');
  });

  it('notes an unusable id that carries no digits the pattern accepts', () => {
    const warnings = new Notes();
    const parsed = {
      feed: {
        entry: [
          {
            title: 'Long id',
            id: 'urn:uuid:x',
            link: [
              {
                '@_rel': 'http://opds-spec.org/image',
                '@_href': `/opds/cover/${'9'.repeat(30)}/x`,
              },
            ],
          },
        ],
      },
    };
    const { books } = shapeFeed(
      parsed,
      'https://books.example.net',
      0,
      warnings
    );
    expect(books[0]!.id).toBeNull();
    expect(warnings.list().join(' ')).toContain('not usable numeric ids');
  });
});
