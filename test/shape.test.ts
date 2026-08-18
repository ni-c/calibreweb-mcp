import { describe, expect, it } from 'vitest';

import { XMLParser } from 'fast-xml-parser';

import {
  absolutize,
  bookIdFromLinks,
  decodeXmlText,
  htmlToText,
  Notes,
  nextOffsetFromLinks,
  parseContentBlob,
  shapeFeed,
  SUMMARY_CHARS,
  TOTAL_SUMMARY_BUDGET,
  UNTRUSTED_CONTENT_NOTE,
  type ShapedBook,
} from '../src/shape.js';
import { BASE_URL, bookEntryXml, feedXml, navEntryXml } from './helpers.js';

// The same parser configuration as api.ts, so shape tests exercise the real
// document structure the server sees.
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  processEntities: false,
  parseTagValue: false,
  parseAttributeValue: false,
  isArray: (name) =>
    ['entry', 'link', 'author', 'category', 'dcterms:language'].includes(name),
  stopNodes: ['feed.entry.content'],
});

function shape(xml: string, offset = 0) {
  const notes = new Notes();
  const shaped = shapeFeed(parser.parse(xml), BASE_URL, offset, notes);
  return { ...shaped, notes };
}

describe('shapeFeed', () => {
  it('shapes a full book entry', () => {
    const xml = feedXml([
      bookEntryXml({
        id: 7,
        uuid: 'abc-123',
        title: 'Dune',
        authors: ['Frank Herbert'],
        publisher: 'Ace',
        tags: ['Science Fiction', 'Classic'],
        rating: 4,
        series: { name: 'Dune Saga', index: '1.00' },
        comment: 'A desert planet epic.',
        formats: [
          { format: 'EPUB', size: 1000, mime: 'application/epub+zip' },
          { format: 'PDF', size: 2000, mime: 'application/pdf' },
        ],
      }),
    ]);
    const { books, notes } = shape(xml);
    expect(books).toHaveLength(1);
    const book = books[0] as ShapedBook;
    expect(book.id).toBe(7);
    expect(book.uuid).toBe('abc-123');
    expect(book.title).toBe('Dune');
    expect(book.authors).toEqual(['Frank Herbert']);
    expect(book.publisher).toBe('Ace');
    expect(book.languages).toEqual(['eng']);
    expect(book.tags).toEqual(['Science Fiction', 'Classic']);
    expect(book.rating).toBe(4);
    expect(book.series).toEqual({ name: 'Dune Saga', index: 1 });
    expect(book.summary).toBe('A desert planet epic.');
    expect(book.coverUrl).toBe(`${BASE_URL}/opds/cover/7`);
    expect(book.formats).toEqual([
      {
        format: 'EPUB',
        mimeType: 'application/epub+zip',
        size: 1000,
        downloadUrl: `${BASE_URL}/opds/download/7/epub/`,
      },
      {
        format: 'PDF',
        mimeType: 'application/pdf',
        size: 2000,
        downloadUrl: `${BASE_URL}/opds/download/7/pdf/`,
      },
    ]);
    expect(notes.list()).toContain(UNTRUSTED_CONTENT_NOTE);
  });

  it('keeps a numeric-looking title a string', () => {
    const { books } = shape(feedXml([bookEntryXml({ title: '1984' })]));
    expect((books[0] as ShapedBook).title).toBe('1984');
  });

  it('extracts the numeric id from the download link when there is no cover', () => {
    const { books } = shape(
      feedXml([bookEntryXml({ id: 55, hasCover: false })])
    );
    const book = books[0] as ShapedBook;
    expect(book.id).toBe(55);
    expect(book.coverUrl).toBeUndefined();
  });

  it('reports id null when the entry has neither cover nor download link', () => {
    const { books, notes } = shape(
      feedXml([bookEntryXml({ hasCover: false, formats: [] })])
    );
    expect((books[0] as ShapedBook).id).toBeNull();
    expect(notes.list().join(' ')).toContain('no numeric id');
  });

  it('decodes XML entities in titles and authors', () => {
    const { books } = shape(
      feedXml([
        bookEntryXml({
          title: 'Pride &amp; Prejudice &#8212; Annotated',
          authors: ['Jane &quot;J&quot; Austen'],
        }),
      ])
    );
    const book = books[0] as ShapedBook;
    expect(book.title).toBe('Pride & Prejudice — Annotated');
    expect(book.authors).toEqual(['Jane "J" Austen']);
  });

  it('parses navigation entries with numeric ids', () => {
    const xml = feedXml([
      navEntryXml('My Shelf', '/opds/shelf/3'),
      navEntryXml('Reading List (Public)', '/opds/shelf/9'),
    ]);
    const { navItems } = shape(xml);
    expect(navItems).toEqual([
      { id: 3, name: 'My Shelf' },
      { id: 9, name: 'Reading List', isPublic: true },
    ]);
  });

  it('skips malformed navigation entries and notes non-numeric ids', () => {
    const xml = feedXml([
      navEntryXml('EPUB', '/opds/formats/EPUB'),
      '  <entry><title>No link</title><id>/x</id></entry>',
    ]);
    const { navItems, notes } = shape(xml);
    expect(navItems).toEqual([{ id: null, name: 'EPUB' }]);
    expect(notes.list().join(' ')).toContain('no numeric id');
  });

  it('parses the next-offset pagination link', () => {
    const xml = feedXml([bookEntryXml()], {
      nextHref: '/opds/new?offset=60',
    });
    const { pagination } = shape(xml);
    expect(pagination).toEqual({ offset: 0, hasMore: true, nextOffset: 60 });
  });

  it('reports hasMore false without a next link', () => {
    const { pagination } = shape(feedXml([bookEntryXml()]), 60);
    expect(pagination).toEqual({ offset: 60, hasMore: false });
  });

  it('survives an empty feed', () => {
    const { books, navItems, notes } = shape(feedXml([]));
    expect(books).toEqual([]);
    expect(navItems).toEqual([]);
    expect(notes.list()).toEqual([]);
  });

  it('survives garbage input', () => {
    const notes = new Notes();
    const shaped = shapeFeed('not a feed', BASE_URL, 0, notes);
    expect(shaped.books).toEqual([]);
  });
});

describe('absolutize', () => {
  it('resolves root-relative hrefs against a subpath base URL', () => {
    expect(
      absolutize('/calibre/opds/cover/1', 'https://host.example/calibre')
    ).toBe('https://host.example/calibre/opds/cover/1');
  });

  it('redacts userinfo smuggled into a same-origin href', () => {
    expect(absolutize('https://user:pass@books.example.net/x', BASE_URL)).toBe(
      'https://***@books.example.net/x'
    );
  });

  it('drops cross-origin hrefs', () => {
    expect(absolutize('https://evil.example/x', BASE_URL)).toBeUndefined();
    expect(absolutize('//evil.example/x', BASE_URL)).toBeUndefined();
  });

  it('drops non-http schemes', () => {
    expect(absolutize('javascript:alert(1)', BASE_URL)).toBeUndefined();
    expect(absolutize('file:///etc/passwd', BASE_URL)).toBeUndefined();
    expect(absolutize('data:text/html,x', BASE_URL)).toBeUndefined();
  });

  it('returns undefined for an unresolvable href', () => {
    expect(absolutize('http://', '')).toBeUndefined();
  });
});

describe('bookIdFromLinks / nextOffsetFromLinks', () => {
  it('ignores lookalike paths', () => {
    expect(
      bookIdFromLinks([{ '@_href': '/opds/covert/12' }, { '@_href': '/x/1' }])
    ).toBeNull();
  });

  it('parses the offset from an entity-encoded next href', () => {
    expect(
      nextOffsetFromLinks([
        { '@_rel': 'next', '@_href': '/opds/new?page=2&amp;offset=120' },
      ])
    ).toBe(120);
  });
});

describe('parseContentBlob', () => {
  it('parses a comma-decimal series index', () => {
    const { series } = parseContentBlob('<div>SERIES: Foo [1,50]<br/></div>', {
      left: TOTAL_SUMMARY_BUDGET,
    });
    expect(series).toEqual({ name: 'Foo', index: 1.5 });
  });

  it('truncates the summary at the per-book cap', () => {
    const long = 'x'.repeat(SUMMARY_CHARS * 3);
    const { summary, summaryTruncated } = parseContentBlob(
      `<div><p>${long}</p></div>`,
      { left: TOTAL_SUMMARY_BUDGET }
    );
    expect(summaryTruncated).toBe(true);
    expect(summary?.length).toBe(SUMMARY_CHARS + 1);
  });

  it('respects the shared budget across books', () => {
    const budget = { left: 10 };
    const { summary } = parseContentBlob(
      '<div><p>0123456789ABCDEF</p></div>',
      budget
    );
    expect(summary).toBe('0123456789…');
    expect(budget.left).toBeLessThanOrEqual(0);
  });
});

describe('hostile feed content', () => {
  it('drops a cross-origin download href and says so', () => {
    const entry = bookEntryXml({ id: 5, hasCover: false, formats: [] }).replace(
      '</entry>',
      '    <link rel="http://opds-spec.org/acquisition" href="file:///etc/shadow" title="EPUB" type="application/epub+zip"/>\n  </entry>'
    );
    const { books, notes } = shape(feedXml([entry]));
    const book = books[0] as ShapedBook;
    expect(
      (book.formats as { downloadUrl?: string }[])[0]?.downloadUrl
    ).toBeUndefined();
    expect(notes.list().join(' ')).toContain('were dropped');
  });

  it('does not resolve prototype members as entity names', () => {
    expect(decodeXmlText('X &constructor; Y')).toBe('X &constructor; Y');
    expect(decodeXmlText('X &hasownproperty; Y')).toBe('X &hasownproperty; Y');
  });

  it('strips C1 controls and BiDi overrides', () => {
    // The C1 entity is refused as a space; the decoded BiDi override is
    // removed entirely by the strip pass.
    expect(decodeXmlText('a&#155;b&#8238;c')).toBe('a bc');
    expect(decodeXmlText('a\u009bb\u202ec')).toBe('abc');
  });

  it('tolerates an object where the title string was expected', () => {
    const entry = bookEntryXml({ id: 3 }).replace(
      '<title>A Test Book</title>',
      '<title><b>nested</b></title>'
    );
    const { books } = shape(feedXml([entry]));
    const book = books[0] as ShapedBook;
    expect(book.id).toBe(3);
    expect(book.title).toBe('');
  });
});

describe('parseContentBlob with escaped comment HTML', () => {
  it('strips tags that arrive XML-escaped, as Calibre-Web renders them', () => {
    // The template autoescapes the comment, so real feeds carry &lt;p&gt;…
    const { summary } = parseContentBlob(
      '<div><p>&lt;p&gt;A &lt;b&gt;bold&lt;/b&gt; description.&lt;/p&gt;</p></div>',
      { left: TOTAL_SUMMARY_BUDGET }
    );
    expect(summary).toBe('A bold description.');
  });
});

describe('htmlToText / decodeXmlText', () => {
  it('strips markup, scripts and control characters', () => {
    const { text } = htmlToText(
      '<div><script>alert(1)</script><p>Hello&nbsp;world &#27;</p></div>',
      200
    );
    expect(text).toBe('Hello world');
  });

  it('strips tags that reassemble across passes (CodeQL js/incomplete-multi-character-sanitization)', () => {
    const { text } = htmlToText(
      '<<script>script>alert(1)<</script>/script>x',
      200
    );
    expect(text).not.toContain('<script');
    expect(text).not.toContain('</script');
  });

  it('refuses to decode control-character entities', () => {
    expect(decodeXmlText('a&#7;b&#x1b;c')).toBe('a b c');
  });
});
