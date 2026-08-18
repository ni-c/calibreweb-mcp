#!/usr/bin/env node
/**
 * Fixture OPDS server for the demo recording (docs/demo.tape).
 *
 * Serves a three-book public-domain library in exactly the XML shape
 * Calibre-Web's feed.xml template produces, so the demo GIF can be recorded —
 * and re-recorded by anyone — without installing Calibre-Web and building a
 * Calibre library first. The MCP server under demonstration runs unmodified;
 * only the library behind it is synthetic.
 *
 *   node docs/demo-server.mjs        # listens on http://127.0.0.1:8099
 */
import { createServer } from 'node:http';

const BOOKS = [
  {
    id: 1,
    uuid: 'c8f5ae0c-5f0d-4c8a-9d3a-000000000001',
    title: 'Frankenstein; Or, The Modern Prometheus',
    authors: ['Mary Wollstonecraft Shelley'],
    published: '1818-01-01T00:00:00+00:00',
    tags: ['Fiction', 'Gothic', 'Classics'],
    rating: 4,
    comment:
      'Victor Frankenstein assembles a living being from dead matter and recoils from what he has made. The creature, abandoned and articulate, follows him across Europe demanding an account.',
    formats: [{ format: 'EPUB', size: 448127 }],
  },
  {
    id: 2,
    uuid: 'c8f5ae0c-5f0d-4c8a-9d3a-000000000002',
    title: 'Moby-Dick; Or, The Whale',
    authors: ['Herman Melville'],
    published: '1851-10-18T00:00:00+00:00',
    tags: ['Fiction', 'Sea stories', 'Classics'],
    rating: 5,
    comment:
      'Ishmael signs on to the whaler Pequod and finds himself aboard the instrument of Captain Ahab’s revenge on the white whale that took his leg.',
    formats: [{ format: 'EPUB', size: 738901 }],
  },
  {
    id: 3,
    uuid: 'c8f5ae0c-5f0d-4c8a-9d3a-000000000003',
    title: 'Pride and Prejudice',
    authors: ['Jane Austen'],
    published: '1813-01-28T00:00:00+00:00',
    tags: ['Fiction', 'Romance', 'Classics'],
    rating: 5,
    comment:
      'Elizabeth Bennet meets Mr. Darcy and dislikes him with great precision. Both are given ample opportunity to revise their first impressions.',
    formats: [{ format: 'EPUB', size: 391414 }],
  },
];

const esc = (s) =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

function entryXml(b) {
  return `  <entry>
    <title>${esc(b.title)}</title>
    <id>urn:uuid:${b.uuid}</id>
    <updated>2026-08-19T12:00:00+00:00</updated>
${b.authors.map((a) => `    <author><name>${esc(a)}</name></author>`).join('\n')}
    <published>${b.published}</published>
    <dcterms:language>eng</dcterms:language>
${b.tags.map((t) => `    <category scheme="http://www.bisg.org/standards/bisac_subject/index.html" term="${esc(t)}" label="${esc(t)}"/>`).join('\n')}
    <content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml">
    RATING: ${'★'.repeat(b.rating)}<br/>
    TAGS: ${esc(b.tags.join(', '))}<br/>
    <p>${esc(b.comment)}</p>
    </div></content>
    <link type="image/jpeg" href="/opds/cover/${b.id}" rel="http://opds-spec.org/image"/>
${b.formats.map((f) => `    <link rel="http://opds-spec.org/acquisition" href="/opds/download/${b.id}/${f.format.toLowerCase()}/" length="${f.size}" title="${f.format}" mtime="2026-08-19T12:00:00+00:00" type="application/epub+zip"/>`).join('\n')}
  </entry>`;
}

function feedXml(books) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/terms/" xmlns:dcterms="http://purl.org/dc/terms/">
  <id>urn:uuid:c8f5ae0c-5f0d-4c8a-9d3a-0000000000ff</id>
  <updated>2026-08-19T12:00:00+00:00</updated>
  <title>Demo Library</title>
  <author><name>Demo Library</name><uri>https://github.com/janeczku/calibre-web</uri></author>
${books.map(entryXml).join('\n')}
</feed>`;
}

// The smallest valid JPEG that image viewers accept — enough for get_cover.
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64'
);

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const atom = { 'Content-Type': 'application/atom+xml; charset=utf-8' };

  if (url.pathname === '/opds/stats') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ books: 3, authors: 3, categories: 6, series: 0 }));
  } else if (url.pathname === '/opds/search') {
    const q = (url.searchParams.get('query') ?? '').toLowerCase();
    const hits = BOOKS.filter((b) =>
      [b.title, ...b.authors, ...b.tags].join(' ').toLowerCase().includes(q)
    );
    res.writeHead(200, atom);
    res.end(feedXml(hits));
  } else if (url.pathname.startsWith('/opds/cover/')) {
    res.writeHead(200, { 'Content-Type': 'image/jpeg' });
    res.end(JPEG);
  } else if (url.pathname.startsWith('/opds/')) {
    res.writeHead(200, atom);
    res.end(feedXml(BOOKS));
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  }
});

server.listen(8099, '127.0.0.1', () => {
  console.error('demo library on http://127.0.0.1:8099');
});
