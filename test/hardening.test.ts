import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CallToolResult } from '@modelcontextprotocol/server';

import { bookEntryXml, connect, feedXml, stubCalibreWeb } from './helpers.js';

function firstText(result: CallToolResult): string {
  const block = result.content[0];
  return block?.type === 'text' ? block.text : '';
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('XML hardening', () => {
  it('refuses a feed with a DOCTYPE declaration', async () => {
    stubCalibreWeb({
      '/opds/new': {
        body:
          '<?xml version="1.0"?><!DOCTYPE feed [<!ENTITY x "y">]>' +
          feedXml([]).replace('<?xml version="1.0" encoding="UTF-8"?>', ''),
      },
    });
    const client = await connect();
    const result = (await client.callTool({
      name: 'list_books',
      arguments: {},
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain('DOCTYPE');
  });

  it('leaves entity references undecoded by the parser (no expansion)', async () => {
    // &xxe; is not one of the built-ins decodeXmlText knows, so it must come
    // through literally — never expanded to anything.
    stubCalibreWeb({
      '/opds/new': { body: feedXml([bookEntryXml({ title: 'A&xxe;B' })]) },
    });
    const client = await connect();
    const result = (await client.callTool({
      name: 'list_books',
      arguments: {},
    })) as CallToolResult;
    expect(firstText(result)).toContain('A&xxe;B');
  });

  it('refuses a feed with a huge declared content-length before reading it', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('irrelevant', {
        status: 200,
        headers: {
          'content-type': 'application/atom+xml',
          'content-length': String(100 * 1024 * 1024),
        },
      })
    );
    const client = await connect();
    const result = (await client.callTool({
      name: 'list_books',
      arguments: {},
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain('larger than');
  });

  it('refuses an oversized chunked feed while streaming', async () => {
    const chunk = new Uint8Array(1024 * 1024);
    let served = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        // 12 MB total, no content-length header.
        if (served >= 12) {
          controller.close();
          return;
        }
        served += 1;
        controller.enqueue(chunk);
      },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: { 'content-type': 'application/atom+xml' },
      })
    );
    const client = await connect();
    const result = (await client.callTool({
      name: 'list_books',
      arguments: {},
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain('larger than');
    // The stream must have been cancelled long before 12 MB.
    expect(served).toBeLessThan(12);
  });

  it('explains an HTML answer instead of dumping it', async () => {
    stubCalibreWeb({
      '/opds/new': {
        body: '<!DOCTYPE html><html><body>Login<script>x</script></body></html>',
        contentType: 'text/html',
      },
    });
    const client = await connect();
    const result = (await client.callTool({
      name: 'list_books',
      arguments: {},
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain('HTML page instead of an Atom feed');
    expect(firstText(result)).not.toContain('<script>');
  });

  it('drops an HTML error body from an upstream error', async () => {
    stubCalibreWeb({
      '/opds/new': {
        body: '<!DOCTYPE html><html><body>Secret proxy page</body></html>',
        status: 502,
      },
    });
    const client = await connect();
    const result = (await client.callTool({
      name: 'list_books',
      arguments: {},
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain('(HTML error page omitted)');
    expect(firstText(result)).not.toContain('Secret proxy page');
  });
});

describe('untrusted content handling', () => {
  it('marks feed data as untrusted', async () => {
    stubCalibreWeb({
      '/opds/new': { body: feedXml([bookEntryXml()]) },
    });
    const client = await connect();
    const result = (await client.callTool({
      name: 'list_books',
      arguments: {},
    })) as CallToolResult;
    expect(firstText(result)).toContain('untrusted data');
  });

  it('strips control characters from metadata', async () => {
    stubCalibreWeb({
      '/opds/new': {
        body: feedXml([bookEntryXml({ title: 'Bad&#27;[31mTitle' })]),
      },
    });
    const client = await connect();
    const result = (await client.callTool({
      name: 'list_books',
      arguments: {},
    })) as CallToolResult;
    expect(firstText(result)).not.toContain('\u001b');
    expect(firstText(result)).toContain('Bad');
  });

  it('redacts credentials from hrefs before they reach the model', async () => {
    const entry = bookEntryXml({ id: 5, hasCover: false, formats: [] }).replace(
      '</entry>',
      '    <link rel="http://opds-spec.org/acquisition" href="https://user:pass@books.example.net/opds/download/5/epub/" title="EPUB" type="application/epub+zip"/>\n  </entry>'
    );
    stubCalibreWeb({ '/opds/new': { body: feedXml([entry]) } });
    const client = await connect();
    const result = (await client.callTool({
      name: 'list_books',
      arguments: {},
    })) as CallToolResult;
    expect(firstText(result)).not.toContain('user:pass');
    expect(firstText(result)).toContain('***@');
  });
});

describe('cover hardening', () => {
  it('refuses a non-image content type', async () => {
    stubCalibreWeb({
      '/opds/cover/7': {
        body: '<html>not an image</html>',
        contentType: 'text/html',
      },
    });
    const client = await connect();
    const result = (await client.callTool({
      name: 'get_cover',
      arguments: { book_id: 7 },
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain('text/html');
  });

  it('refuses an svg cover (active content)', async () => {
    stubCalibreWeb({
      '/opds/cover/7': {
        body: '<svg onload="alert(1)"/>',
        contentType: 'image/svg+xml',
      },
    });
    const client = await connect();
    const result = (await client.callTool({
      name: 'get_cover',
      arguments: { book_id: 7 },
    })) as CallToolResult;
    expect(result.isError).toBe(true);
  });

  it('refuses an oversized cover', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('x', {
        status: 200,
        headers: {
          'content-type': 'image/jpeg',
          'content-length': String(50 * 1024 * 1024),
        },
      })
    );
    const client = await connect();
    const result = (await client.callTool({
      name: 'get_cover',
      arguments: { book_id: 7 },
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain('larger than');
  });

  it('rejects a non-positive book id without fetching', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const client = await connect();
    const result = (await client.callTool({
      name: 'get_cover',
      arguments: { book_id: -1 },
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('result ceiling', () => {
  it('keeps a giant search result under the hard cap', async () => {
    const entries = Array.from({ length: 200 }, (_, i) =>
      bookEntryXml({
        id: i + 1,
        uuid: `uuid-${i}`,
        title: `Book ${i} ${'t'.repeat(500)}`,
        comment: 'c'.repeat(2000),
      })
    );
    stubCalibreWeb({ '/opds/search': { body: feedXml(entries) } });
    const client = await connect();
    const result = (await client.callTool({
      name: 'search_books',
      arguments: { query: 'book', limit: 200 },
    })) as CallToolResult;
    expect(firstText(result).length).toBeLessThanOrEqual(400_000 + 1000);
  });
});

describe('transport hardening', () => {
  it('sends redirect error and a timeout signal on every request', async () => {
    let init: RequestInit | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (_input: RequestInfo | URL, requestInit?: RequestInit) => {
        init = requestInit;
        return new Response(feedXml([]), {
          status: 200,
          headers: { 'content-type': 'application/atom+xml' },
        });
      }
    );
    const client = await connect();
    await client.callTool({ name: 'list_books', arguments: {} });
    expect(init?.redirect).toBe('error');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
});
