import { vi, type MockInstance } from 'vitest';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import type { Config } from '../src/config.js';
import { createServer } from '../src/server.js';

export const BASE_URL = 'https://books.example.net';

export const testConfig: Config = {
  url: BASE_URL,
  username: 'reader',
  password: 'secret',
  insecureTls: false,
};

/** The Authorization header the test config must produce. */
export const EXPECTED_AUTH = `Basic ${Buffer.from('reader:secret').toString('base64')}`;

export interface RecordedCall {
  url: string;
  path: string;
  query: URLSearchParams;
  method: string;
  headers: Record<string, string>;
}

export interface RouteResponse {
  body: string | Buffer;
  status?: number;
  contentType?: string;
}

/** Route table: exact path (without query) → response, or a function of the call. */
export type Routes = Record<
  string,
  RouteResponse | ((call: RecordedCall) => RouteResponse)
>;

export interface FetchStub {
  spy: MockInstance;
  calls: RecordedCall[];
}

/**
 * Replaces global fetch with a stub answering from a route table keyed by URL
 * path. An unrouted path fails the test loudly instead of returning something
 * plausible.
 */
export function stubCalibreWeb(routes: Routes = {}): FetchStub {
  const calls: RecordedCall[] = [];
  const spy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const parsed = new URL(url);
        const call: RecordedCall = {
          url,
          path: parsed.pathname,
          query: parsed.searchParams,
          method: init?.method ?? 'GET',
          headers: (init?.headers as Record<string, string>) ?? {},
        };
        calls.push(call);

        const route = routes[parsed.pathname];
        if (route === undefined) {
          throw new Error(`stubCalibreWeb: unrouted path ${parsed.pathname}`);
        }
        const spec = typeof route === 'function' ? route(call) : route;
        return new Response(new Uint8Array(Buffer.from(spec.body)), {
          status: spec.status ?? 200,
          headers: {
            'content-type':
              spec.contentType ?? 'application/atom+xml; charset=utf-8',
          },
        });
      }
    );
  return { spy, calls };
}

export async function connect(
  overrides: Partial<Config> = {}
): Promise<Client> {
  const server = createServer({ ...testConfig, ...overrides });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  return client;
}

// --- OPDS fixtures, mirrored from cps/templates/feed.xml -------------------

export interface BookFixture {
  id?: number;
  uuid?: string;
  title?: string;
  authors?: string[];
  publisher?: string;
  published?: string;
  languages?: string[];
  tags?: string[];
  /** Star count 1-5, rendered as the RATING line. */
  rating?: number;
  series?: { name: string; index: string };
  comment?: string;
  hasCover?: boolean;
  formats?: { format: string; size?: number; mime?: string }[];
  updated?: string;
}

export function bookEntryXml(fixture: BookFixture = {}): string {
  const {
    id = 42,
    uuid = '2853dacf-ed79-42f5-8e8a-a7bb3d1ae6a2',
    title = 'A Test Book',
    authors = ['Ada Author'],
    publisher,
    published = '2020-05-01T00:00:00+00:00',
    languages = ['eng'],
    tags = [],
    rating,
    series,
    comment,
    hasCover = true,
    formats = [{ format: 'EPUB', size: 123456, mime: 'application/epub+zip' }],
    updated = '2024-01-02T03:04:05+00:00',
  } = fixture;

  const contentLines = [
    rating !== undefined ? `RATING: ${'★'.repeat(rating)}<br/>` : '',
    tags.length > 0 ? `TAGS: ${tags.join(', ')}<br/>` : '',
    series !== undefined ? `SERIES: ${series.name} [${series.index}]<br/>` : '',
    comment !== undefined ? `<p>${comment}</p>` : '',
  ]
    .filter((l) => l !== '')
    .join('\n    ');

  return `  <entry>
    <title>${title}</title>
    <id>urn:uuid:${uuid}</id>
    <updated>${updated}</updated>
${authors.map((a) => `    <author><name>${a}</name></author>`).join('\n')}
${publisher !== undefined ? `    <publisher><name>${publisher}</name></publisher>` : ''}
    <published>${published}</published>
${languages.map((l) => `    <dcterms:language>${l}</dcterms:language>`).join('\n')}
${tags
  .map(
    (t) =>
      `    <category scheme="http://www.bisg.org/standards/bisac_subject/index.html" term="${t}" label="${t}"/>`
  )
  .join('\n')}
    <content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml">
    ${contentLines}
    </div></content>
${
  hasCover
    ? `    <link type="image/jpeg" href="/opds/cover/${id}" rel="http://opds-spec.org/image"/>
    <link type="image/jpeg" href="/opds/cover/${id}" rel="http://opds-spec.org/image/thumbnail"/>`
    : ''
}
${formats
  .map(
    (f) =>
      `    <link rel="http://opds-spec.org/acquisition" href="/opds/download/${id}/${f.format.toLowerCase()}/" length="${f.size ?? 1000}" title="${f.format}" mtime="${updated}" type="${f.mime ?? 'application/octet-stream'}"/>`
  )
  .join('\n')}
  </entry>`;
}

export function navEntryXml(name: string, href: string): string {
  return `  <entry>
    <title>${name}</title>
    <id>${href}</id>
    <link rel="subsection" type="application/atom+xml;profile=opds-catalog" href="${href}"/>
  </entry>`;
}

export function feedXml(
  entries: string[],
  options: { nextHref?: string } = {}
): string {
  const next =
    options.nextHref !== undefined
      ? `  <link rel="next" title="Next" href="${options.nextHref}" type="application/atom+xml;profile=opds-catalog;type=feed;kind=navigation"/>\n`
      : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/terms/" xmlns:dcterms="http://purl.org/dc/terms/">
  <id>urn:uuid:2853dacf-ed79-42f5-8e8a-a7bb3d1ae6a2</id>
  <updated>2024-01-02T03:04:05+00:00</updated>
  <link rel="self" href="/opds/new" type="application/atom+xml;profile=opds-catalog;type=feed;kind=navigation"/>
  <link rel="start" href="/opds/" type="application/atom+xml;profile=opds-catalog;type=feed;kind=navigation"/>
${next}  <title>Test Library</title>
  <author>
    <name>Test Library</name>
    <uri>https://github.com/janeczku/calibre-web</uri>
  </author>
${entries.join('\n')}
</feed>`;
}

/** A tiny valid JPEG-ish payload; content sniffing is not part of the server. */
export function jpegResponse(bytes = 64): RouteResponse {
  return {
    body: Buffer.alloc(bytes, 0xff),
    contentType: 'image/jpeg',
  };
}
