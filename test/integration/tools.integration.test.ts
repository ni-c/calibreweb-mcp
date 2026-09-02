import {
  expectEveryToolDeclaresOutputSchema,
  expectEveryToolExercised,
  startServer,
  toolCoverage,
  type LiveHarness,
} from 'mcp-integration-harness';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ALL_TOOLS } from '../../src/tools/catalogue.js';
import { bootstrap, SHELF, TITLES, type Sandbox } from './bootstrap.js';

/**
 * Every tool in the catalogue, against a real Calibre-Web in Docker.
 *
 * There is no confirmation dialog anywhere in this file and there should not
 * be: this server is read-only by construction — it speaks OPDS and has no
 * write tools at all — so there is nothing to guard. What it does have is an
 * **XML parser fed by a third party**, and that is the half a stubbed feed
 * cannot exercise: the fixtures in `test/` are documents this repository wrote,
 * so they agree with its own reading of the format. Here the Atom comes out of
 * Calibre-Web.
 */

let sandbox: Sandbox;
let harness: LiveHarness;

function parse<T>(text: string): T {
  const start = text.indexOf('{');
  if (start === -1) throw new Error(`no JSON in result: ${text.slice(0, 300)}`);
  return JSON.parse(text.slice(start)) as T;
}

interface Books {
  books: { id: number | null; title: string; authors?: string[] }[];
  totalFound?: number;
  pagination?: { nextOffset?: number };
}

beforeAll(async () => {
  sandbox = await bootstrap();
  harness = await startServer({ env: sandbox.env });
}, 600_000);

afterAll(async () => {
  await harness?.close();
});

describe('the library', () => {
  it('reports what is in it', async () => {
    const stats = await harness.call('get_stats');
    expect(stats).toContain('3');
  });

  it('lists the books, with ids the other tools can use', async () => {
    const listed = parse<Books>(await harness.call('list_books'));
    expect(listed.books.map((b) => b.title).sort()).toEqual([...TITLES].sort());
    // A book without an id cannot be passed to get_cover, so the id has to
    // survive the OPDS entry — which is exactly the parsing a fixture agrees
    // with by construction.
    for (const book of listed.books) {
      expect(book.id).toBeTypeOf('number');
    }
  });

  it('lists an alphabetical view, which paginates differently', async () => {
    // "all" is the paginated view and takes a letter; the others do not. Two
    // code paths, one tool, and only the real server enforces the difference.
    const all = parse<Books>(
      await harness.call('list_books', { view: 'all', letter: '00' })
    );
    expect(all.books.length).toBeGreaterThan(0);

    const discover = parse<Books>(
      await harness.call('list_books', { view: 'discover' })
    );
    expect(discover.pagination?.nextOffset).toBeUndefined();
  });

  it('searches by title and by author', async () => {
    const byTitle = parse<Books>(
      await harness.call('search_books', { query: 'Dune' })
    );
    expect(byTitle.books.map((b) => b.title)).toContain('Dune');

    const byAuthor = parse<Books>(
      await harness.call('search_books', { query: 'Le Guin' })
    );
    expect(byAuthor.books.map((b) => b.title)).toContain('The Dispossessed');
  });

  it('answers a search that matches nothing, without failing', async () => {
    const none = parse<Books>(
      await harness.call('search_books', { query: 'zzzznothing' })
    );
    expect(none.books).toHaveLength(0);
  });
});

describe('shelves', () => {
  it('lists them and reads one', async () => {
    const shelves = parse<{
      shelves: { id: number; name: string; isPublic?: boolean }[];
    }>(await harness.call('list_shelves'));
    // Exactly one, and the one the bootstrap made. Calibre-Web does not refuse
    // a second shelf of the same title, so a length assertion here is what
    // notices a stack that was reused rather than recreated.
    const named = shelves.shelves.filter((s) => s.name === SHELF);
    expect(named).toHaveLength(1);
    const shelf = named[0];
    expect(shelf!.id).toBe(sandbox.shelfId);
    // `isPublic` is only reported on an English-locale instance, because
    // Calibre-Web marks public shelves with a localized title suffix and this
    // server parses that suffix. The container runs in English.
    expect(shelf!.isPublic).toBe(true);

    const books = parse<Books>(
      await harness.call('get_shelf_books', { shelf_id: shelf!.id })
    );
    // Two of the three books are on it, which is what makes this a shelf
    // rather than another view of the library.
    expect(books.books).toHaveLength(2);
    expect(books.books.map((b) => b.title)).toContain('Dune');
    expect(books.books.map((b) => b.title)).not.toContain(
      'Rendezvous with Rama'
    );
  });
});

describe('covers', () => {
  it('fetches real image bytes', async () => {
    const listed = parse<Books>(await harness.call('list_books'));
    const id = listed.books[0]?.id;
    expect(id).toBeTypeOf('number');

    // An image part, not text: the one tool here that does not return JSON,
    // so the assertion looks at the parts rather than at the text `call`
    // would otherwise join.
    const result = await harness.raw('get_cover', { book_id: id });
    const image = result.content?.find((part) => part.type === 'image');
    expect(image).toBeDefined();
    expect(image!.mimeType).toMatch(/^image\//);
    expect(Buffer.from(image!.data ?? '', 'base64').byteLength).toBeGreaterThan(
      0
    );
  });
});

describe('the untrusted-content framing', () => {
  it('is on every listing, because a library is somebody else’s text', async () => {
    // Titles, authors and blurbs are whatever was in the EPUB metadata. On a
    // shared instance that is not the operator's writing. The warning rides in
    // a `notes` array inside the result rather than as a preamble, so it
    // survives a client that renders only the JSON.
    for (const tool of ['list_books', 'search_books', 'list_shelves']) {
      const result = parse<{ notes?: string[] }>(
        await harness.call(
          tool,
          tool === 'search_books' ? { query: 'Dune' } : {}
        )
      );
      expect(result.notes?.join(' ')).toContain('untrusted data');
    }
  });
});

it('declares an output schema on every tool', async () => {
  // The unit suite checks the same thing against a stub. Here it is checked
  // against the server that has just answered every one of these tools with a
  // real Calibre-Web feed — and each of those answers went through the SDK's
  // validation against the schema below it, which is the half a stub cannot
  // prove.
  const { tools } = await harness.client.listTools();
  expectEveryToolDeclaresOutputSchema(tools);
});

it('exercises every tool in the catalogue', () => {
  const report = toolCoverage(harness, ALL_TOOLS, {});
  console.log(
    `calibreweb-mcp: ${report.called.length}/${ALL_TOOLS.length} tools against a real Calibre-Web`
  );
  expectEveryToolExercised(harness, ALL_TOOLS, {});
});
