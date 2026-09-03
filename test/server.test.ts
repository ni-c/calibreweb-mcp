import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CallToolResult } from '@modelcontextprotocol/server';
import {
  bookEntryXml,
  connect,
  EXPECTED_AUTH,
  feedXml,
  jpegResponse,
  navEntryXml,
  stubCalibreWeb,
} from './helpers.js';
import { expectPortableToolSchemas } from 'mcp-integration-harness';

const TOOLS = [
  'search_books',
  'list_books',
  'list_shelves',
  'get_shelf_books',
  'get_cover',
  'get_stats',
];

function firstText(result: CallToolResult): string {
  const block = result.content[0];
  return block?.type === 'text' ? block.text : '';
}

function parseJson(result: CallToolResult): Record<string, unknown> {
  return JSON.parse(firstText(result)) as Record<string, unknown>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('tool registration', () => {
  it('lists every tool', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOLS].sort());
  });

  it('marks every tool read-only', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);
    }
  });

  it('declares an output schema on every tool', async () => {
    // The same argument as the annotations below, one field along. A tool that
    // says nothing about its result forces a client to parse prose to find out
    // what it got, and the SDK sends no `structuredContent` at all for a tool
    // that declared no schema — so the machine-readable half does not exist
    // until this is here.
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) {
      expect(tool.outputSchema, tool.name).toBeDefined();
      // An object root, not merely a schema. SEP-2106 allows an array or a
      // scalar, but a 2025-era client is served that same tool with the schema
      // rewritten to `{result: …}` — so the tool would answer in two different
      // shapes depending on who asked.
      expect(tool.outputSchema?.type, tool.name).toBe('object');
    }
  });

  it('advertises schemas every client can read', async () => {
    // Legal JSON Schema is not enough. `{}` in a schema position — what zod
    // writes for `looseObject`, `catchall` and `z.unknown()` — and `type` as an
    // array are both refused, or silently dropped, by some clients. Neither is
    // a contract: each has an equivalent spelling that says the same thing, so
    // there is nothing here to excuse.
    const client = await connect();
    const { tools } = await client.listTools();
    expectPortableToolSchemas(tools);
  });

  it('marks every result built from library metadata as untrusted', async () => {
    // The marker has to survive into the structured channel, or a client that
    // reads only `structuredContent` — which is the point of declaring a schema
    // at all — gets a publisher's free text with no framing whatsoever.
    const client = await connect();
    const { tools } = await client.listTools();
    const plain = tools
      .filter((tool) => {
        const properties = tool.outputSchema?.properties as
          Record<string, unknown> | undefined;
        return properties?.untrusted === undefined;
      })
      .map((tool) => tool.name)
      .sort();
    // get_stats is four counters this server checked are numbers; get_cover
    // reports an id, a media type from a four-entry allowlist and a byte
    // count. Neither carries anything a publisher wrote.
    expect(plain).toEqual(['get_cover', 'get_stats']);
  });

  it('declares all four annotation hints on every tool', async () => {
    // Not a style rule. Two of the four default to a *stronger* claim than
    // silence suggests: the specification gives destructiveHint and
    // openWorldHint a default of true, so a tool that omits them announces
    // itself as destructive and open-world. Leaving them out is a statement,
    // not an abstention — so every tool states all four.
    const client = await connect();
    const { tools } = await client.listTools();
    const hints = [
      'readOnlyHint',
      'destructiveHint',
      'idempotentHint',
      'openWorldHint',
    ] as const;
    for (const tool of tools) {
      for (const hint of hints) {
        expect(typeof tool.annotations?.[hint], `${tool.name}.${hint}`).toBe(
          'boolean'
        );
      }
    }
  });

  it('lists tools without any configuration', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const client = await connect({
      url: undefined,
      username: undefined,
      password: undefined,
    });
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(TOOLS.length);
  });

  it('fails a call without configuration instead of fetching', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const client = await connect({ url: undefined });
    const result = (await client.callTool({
      name: 'get_stats',
      arguments: {},
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain('CALIBRE_WEB_URL');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('search_books', () => {
  it('queries the search feed with Basic auth', async () => {
    const stub = stubCalibreWeb({
      '/opds/search': { body: feedXml([bookEntryXml({ id: 1 })]) },
    });
    const client = await connect();
    const result = (await client.callTool({
      name: 'search_books',
      arguments: { query: 'dune' },
    })) as CallToolResult;

    expect(stub.calls).toHaveLength(1);
    const call = stub.calls[0]!;
    expect(call.path).toBe('/opds/search');
    expect(call.query.get('query')).toBe('dune');
    expect(call.headers.Authorization).toBe(EXPECTED_AUTH);

    const data = parseJson(result);
    expect(data.totalFound).toBe(1);
    expect(data.truncated).toBe(false);
    expect((data.books as unknown[]).length).toBe(1);
  });

  it('truncates client-side at the limit and says so', async () => {
    const entries = Array.from({ length: 5 }, (_, i) =>
      bookEntryXml({ id: i + 1, uuid: `uuid-${i}`, title: `Book ${i}` })
    );
    stubCalibreWeb({ '/opds/search': { body: feedXml(entries) } });
    const client = await connect();
    const result = (await client.callTool({
      name: 'search_books',
      arguments: { query: 'book', limit: 2 },
    })) as CallToolResult;
    const data = parseJson(result);
    expect(data.totalFound).toBe(5);
    expect(data.truncated).toBe(true);
    expect((data.books as unknown[]).length).toBe(2);
    expect(JSON.stringify(data.notes)).toContain('first 2');
  });

  it('sends no Authorization header in anonymous mode', async () => {
    const stub = stubCalibreWeb({
      '/opds/search': { body: feedXml([]) },
    });
    const client = await connect({ username: undefined, password: undefined });
    await client.callTool({ name: 'search_books', arguments: { query: 'x' } });
    expect(stub.calls[0]!.headers.Authorization).toBeUndefined();
  });
});

describe('list_books', () => {
  const routeOf = async (
    args: Record<string, unknown>
  ): Promise<{
    path: string;
    query: URLSearchParams;
    result: CallToolResult;
  }> => {
    const stub = stubCalibreWeb({
      '/opds/new': { body: feedXml([bookEntryXml()]) },
      '/opds/hot': { body: feedXml([]) },
      '/opds/rated': { body: feedXml([]) },
      '/opds/discover': { body: feedXml([]) },
      '/opds/readbooks': { body: feedXml([]) },
      '/opds/unreadbooks': { body: feedXml([]) },
      '/opds/books/letter/D': { body: feedXml([]) },
      '/opds/books/letter/00': { body: feedXml([]) },
    });
    const client = await connect();
    const result = (await client.callTool({
      name: 'list_books',
      arguments: args,
    })) as CallToolResult;
    const call = stub.calls[0]!;
    return { path: call.path, query: call.query, result };
  };

  it('defaults to the new view', async () => {
    const { path, result } = await routeOf({});
    expect(path).toBe('/opds/new');
    expect(parseJson(result).view).toBe('new');
  });

  it('passes the offset through', async () => {
    const { path, query } = await routeOf({ view: 'hot', offset: 120 });
    expect(path).toBe('/opds/hot');
    expect(query.get('offset')).toBe('120');
  });

  it('ignores the offset on the discover view', async () => {
    const { path, query } = await routeOf({ view: 'discover', offset: 60 });
    expect(path).toBe('/opds/discover');
    expect(query.get('offset')).toBeNull();
  });

  it('maps view all to the letter route, uppercased', async () => {
    const { path } = await routeOf({ view: 'all', letter: 'd' });
    expect(path).toBe('/opds/books/letter/D');
  });

  it('rejects a letter on other views without fetching', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const client = await connect();
    const result = (await client.callTool({
      name: 'list_books',
      arguments: { view: 'new', letter: 'A' },
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects a multi-character letter without fetching', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const client = await connect();
    const result = (await client.callTool({
      name: 'list_books',
      arguments: { view: 'all', letter: '../etc' },
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain('invalid letter');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('surfaces pagination from the feed', async () => {
    stubCalibreWeb({
      '/opds/new': {
        body: feedXml([bookEntryXml()], { nextHref: '/opds/new?offset=60' }),
      },
    });
    const client = await connect();
    const result = (await client.callTool({
      name: 'list_books',
      arguments: {},
    })) as CallToolResult;
    expect(parseJson(result).pagination).toEqual({
      offset: 0,
      hasMore: true,
      nextOffset: 60,
    });
  });
});

describe('shelves', () => {
  it('lists shelves with ids and public flag', async () => {
    stubCalibreWeb({
      '/opds/shelfindex': {
        body: feedXml([
          navEntryXml('Mine', '/opds/shelf/1'),
          navEntryXml('Shared (Public)', '/opds/shelf/2'),
        ]),
      },
    });
    const client = await connect();
    const result = (await client.callTool({
      name: 'list_shelves',
      arguments: {},
    })) as CallToolResult;
    expect(parseJson(result).shelves).toEqual([
      { id: 1, name: 'Mine' },
      { id: 2, name: 'Shared', isPublic: true },
    ]);
  });

  it('fetches shelf books by id', async () => {
    const stub = stubCalibreWeb({
      '/opds/shelf/3': { body: feedXml([bookEntryXml({ id: 9 })]) },
    });
    const client = await connect();
    const result = (await client.callTool({
      name: 'get_shelf_books',
      arguments: { shelf_id: 3, offset: 60 },
    })) as CallToolResult;
    expect(stub.calls[0]!.path).toBe('/opds/shelf/3');
    expect(stub.calls[0]!.query.get('offset')).toBe('60');
    const data = parseJson(result);
    expect(data.shelfId).toBe(3);
    expect((data.books as { id: number }[])[0]!.id).toBe(9);
  });

  it('notes that an empty shelf may not exist', async () => {
    stubCalibreWeb({ '/opds/shelf/99': { body: feedXml([]) } });
    const client = await connect();
    const result = (await client.callTool({
      name: 'get_shelf_books',
      arguments: { shelf_id: 99 },
    })) as CallToolResult;
    expect(JSON.stringify(parseJson(result).notes)).toContain('does not exist');
  });

  it('rejects a non-integer shelf id', async () => {
    const client = await connect();
    const result = (await client.callTool({
      name: 'get_shelf_books',
      arguments: { shelf_id: 1.5 },
    })) as CallToolResult;
    expect(result.isError).toBe(true);
  });
});

describe('get_cover', () => {
  it('returns the cover as image content', async () => {
    const stub = stubCalibreWeb({ '/opds/cover/7': jpegResponse(32) });
    const client = await connect();
    const result = (await client.callTool({
      name: 'get_cover',
      arguments: { book_id: 7 },
    })) as CallToolResult;
    expect(stub.calls[0]!.path).toBe('/opds/cover/7');
    const block = result.content[0]!;
    expect(block.type).toBe('image');
    if (block.type === 'image') {
      expect(block.mimeType).toBe('image/jpeg');
      expect(Buffer.from(block.data, 'base64')).toHaveLength(32);
    }
  });
});

describe('get_stats', () => {
  it('returns the four counters and drops extras', async () => {
    stubCalibreWeb({
      '/opds/stats': {
        body: JSON.stringify({
          books: 12,
          authors: 5,
          categories: 3,
          series: 2,
          injected: 'ignore me',
        }),
        contentType: 'application/json',
      },
    });
    const client = await connect();
    const result = (await client.callTool({
      name: 'get_stats',
      arguments: {},
    })) as CallToolResult;
    expect(parseJson(result)).toEqual({
      books: 12,
      authors: 5,
      categories: 3,
      series: 2,
    });
  });
});

describe('upstream errors', () => {
  it('maps a 401 to a credentials hint', async () => {
    stubCalibreWeb({
      '/opds/new': { body: 'Unauthorized Access', status: 401 },
    });
    const client = await connect();
    const result = (await client.callTool({
      name: 'list_books',
      arguments: {},
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain('CALIBRE_WEB_USERNAME');
  });

  it('maps a 403 to the read/unread hint', async () => {
    stubCalibreWeb({ '/opds/readbooks': { body: 'Forbidden', status: 403 } });
    const client = await connect();
    const result = (await client.callTool({
      name: 'list_books',
      arguments: { view: 'read' },
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain('non-anonymous');
  });
});
