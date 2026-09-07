import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CallToolResult } from '@modelcontextprotocol/server';
import type { Client } from '@modelcontextprotocol/client';

import { connect, feedXml, navEntryXml } from './helpers.js';

/**
 * Every feed-reading tool, driven through a connected client, over feeds whose
 * fields were chosen by whoever wrote the library.
 *
 * The example tests name the constructions someone thought of. This one exists
 * for the two sentences that mean a tool answered with no cause a model can
 * act on: `Output validation error`, which is what the SDK says when a result
 * breaks the tool's own output schema, and `Cannot read properties`, which is
 * what a value of the wrong shape says on the way past a boundary that did not
 * check it. The client lists once in `connect`, so the client-side schema
 * check runs on every success path here too.
 */
const RUNS = { numRuns: Number(process.env.SHAPE_RUNS ?? 60) };

/** Values a feed can carry that a boundary has to survive. */
const hostile = fc.oneof(
  fc.constantFrom(
    '9'.repeat(400),
    '99999999999999999999',
    '-1',
    '1e999',
    'NaN',
    'Infinity',
    '0',
    '00',
    'x'.repeat(3000),
    '&#xD800;',
    '&#55296;',
    '&constructor;',
    '&#0000000060;script&#62;',
    '&amp;lt;script&amp;gt;',
    '<'.repeat(120),
    '&lt;'.repeat(120),
    String.fromCodePoint(0x1f600),
    String.fromCodePoint(0x202e),
    String.fromCodePoint(0xfffd)
  ),
  fc.string({ maxLength: 40 })
);

interface Poison {
  title: string;
  author: string;
  published: string;
  content: string;
  id: string;
  length: string;
  format: string;
  offset: string;
}

const poison = fc.record<Poison>({
  title: hostile,
  author: hostile,
  published: hostile,
  content: hostile,
  id: hostile,
  length: hostile,
  format: hostile,
  offset: hostile,
});

function poisonedFeed(v: Poison): string {
  return feedXml(
    [
      `  <entry>
    <title>${v.title}</title>
    <id>urn:uuid:${v.id}</id>
    <updated>${v.published}</updated>
    <author><name>${v.author}</name></author>
    <published>${v.published}</published>
    <dcterms:language>${v.format}</dcterms:language>
    <category term="${v.format}" label="${v.format}"/>
    <content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml">RATING: ${v.format}<br/>
    SERIES: ${v.title} [${v.length}]<br/>
    <p>${v.content}</p>
    </div></content>
    <link type="image/jpeg" href="/opds/cover/${v.id}" rel="http://opds-spec.org/image"/>
    <link rel="http://opds-spec.org/acquisition" href="/opds/download/${v.id}/epub/" length="${v.length}" title="${v.format}" type="${v.format}"/>
  </entry>`,
      navEntryXml(v.title, `/opds/shelf/${v.id}`),
    ],
    { nextHref: `/opds/new?offset=${v.offset}` }
  );
}

const CALLS = [
  { name: 'list_books', arguments: {} },
  { name: 'list_shelves', arguments: {} },
  { name: 'get_shelf_books', arguments: { shelf_id: 3 } },
  { name: 'search_books', arguments: { query: 'x' } },
] as const;

const ROUTES = [
  '/opds/new',
  '/opds/shelfindex',
  '/opds/shelf/3',
  '/opds/search',
];

afterEach(() => {
  vi.restoreAllMocks();
});

function check(result: CallToolResult): void {
  const block = result.content[0];
  const text = block?.type === 'text' ? block.text : '';
  expect(text).not.toContain('Output validation error');
  expect(text).not.toContain('Cannot read properties');
  expect(text).not.toContain('is not a function');
  if (result.isError === true) return;
  // Both channels carry the same value, always.
  expect(JSON.parse(text)).toEqual(result.structuredContent);
}

describe('no feed can make a tool answer without a cause', () => {
  async function drive(
    client: Client,
    body: () => string
  ): Promise<CallToolResult[]> {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const path = new URL(String(input)).pathname;
      if (!ROUTES.includes(path)) throw new Error(`unrouted ${path}`);
      return new Response(body(), {
        status: 200,
        headers: { 'content-type': 'application/atom+xml' },
      });
    });
    const results: CallToolResult[] = [];
    for (const call of CALLS) {
      results.push(
        (await client.callTool({
          name: call.name,
          arguments: call.arguments,
        })) as CallToolResult
      );
    }
    return results;
  }

  it('survives a feed built from hostile field values', async () => {
    const client = await connect();
    await fc.assert(
      fc.asyncProperty(poison, async (v) => {
        const results = await drive(client, () => poisonedFeed(v));
        for (const result of results) check(result);
      }),
      RUNS
    );
  });

  it('survives a body that is not a feed at all', async () => {
    const client = await connect();
    await fc.assert(
      fc.asyncProperty(fc.string({ maxLength: 200 }), async (body) => {
        const results = await drive(client, () => body);
        for (const result of results) check(result);
      }),
      RUNS
    );
  });
});
