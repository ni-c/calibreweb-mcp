import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { redactUrlCredentials } from '../src/redact.js';
import { absolutize, decodeXmlText, htmlToText } from '../src/shape.js';

/**
 * Properties over the three functions that read hostile input.
 *
 * Everything here is fed by an OPDS feed, which is a document from the other
 * side: `htmlToText` turns its markup into text a client may render, and
 * `absolutize` decides which of its links are allowed to reach the model at
 * all. The example tests name the constructions someone thought of; these say
 * what must hold for every input, which is the only useful shape when the input
 * is chosen by whoever wrote the feed.
 */

const RUNS = { numRuns: 500 };

const BASE = 'https://library.example.com';

describe('credential redaction', () => {
  it('is idempotent', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), (value) => {
        const once = redactUrlCredentials(value);
        expect(redactUrlCredentials(once)).toBe(once);
      }),
      RUNS
    );
  });

  it('leaves a URL without credentials byte-identical', () => {
    fc.assert(
      fc.property(fc.webUrl(), (url) => {
        fc.pre(!url.includes('@'));
        expect(redactUrlCredentials(url)).toBe(url);
      }),
      RUNS
    );
  });

  /**
   * No part of the password survives, including the tail after an `@` inside it.
   *
   * This is the property the fix is about. The class used to exclude `@`, so
   * the match stopped at the *first* one and `https://alice:p@ssw0rd@host` came
   * back as `https://***@ssw0rd@host` — the interesting half of the password,
   * published into the model context and the transcript. A password containing
   * `@` is not exotic here: the people this function exists for are the ones
   * who paste `https://user:pass@host` into a config file.
   */
  it('publishes no fragment of a password, wherever its @ falls', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z]{3,12}$/),
        fc.stringMatching(/^[A-Za-z0-9]{3,10}$/),
        fc.stringMatching(/^[A-Za-z0-9]{3,10}$/),
        fc.stringMatching(/^[a-z]{3,12}(\.[a-z]{2,6})+$/),
        (user, head, tail, host) => {
          // Only so the two assertions below stay about the password: a
          // fragment that also occurs in the generated host would be found in
          // the output for a reason that has nothing to do with redaction.
          fc.pre(!host.includes(head) && !host.includes(tail));
          const password = `${head}@${tail}`;
          const redacted = redactUrlCredentials(
            `https://${user}:${password}@${host}/opds`
          );
          expect(redacted).toBe(`https://***@${host}/opds`);
          expect(redacted).not.toContain(head);
          expect(redacted).not.toContain(tail);
        }
      ),
      RUNS
    );
  });
});

describe('link absolutisation refuses everything off-origin', () => {
  /**
   * `new URL(href, base)` ignores the base for an absolute href, so without
   * this check a hostile feed could plant `javascript:`, `file:` or a
   * cross-origin URL into the model context as a legitimate-looking library
   * link. Stated over arbitrary hrefs rather than the four schemes someone
   * listed.
   */
  it('never returns a URL outside the configured origin', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), (href) => {
        const resolved = absolutize(href, BASE);
        if (resolved === undefined) return;
        expect(new URL(resolved).origin).toBe(BASE);
      }),
      RUNS
    );
  });

  it('never returns anything but http or https', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          'javascript',
          'file',
          'data',
          'vbscript',
          'ftp',
          'mailto',
          'blob'
        ),
        fc.string({ maxLength: 30 }),
        (scheme, rest) => {
          expect(absolutize(`${scheme}:${rest}`, BASE)).toBeUndefined();
        }
      ),
      RUNS
    );
  });

  it('an on-origin path always resolves, and carries no credentials', () => {
    fc.assert(
      fc.property(fc.webPath(), (path) => {
        const resolved = absolutize(`${BASE}${path}`, BASE);
        if (resolved === undefined) return;
        expect(resolved.startsWith(BASE)).toBe(true);
        expect(redactUrlCredentials(resolved)).toBe(resolved);
      }),
      RUNS
    );
  });
});

describe('markup never survives into the text', () => {
  /**
   * The fixpoint loop, stated as the property it exists for.
   *
   * A single pass lets overlapping constructs reassemble — `<<script>script>`
   * becomes `<script>` after one round — and the output is plain text a client
   * may render as markdown, so no fragment may survive. The loop in
   * `htmlToText` is what makes that true; this is what checks it, over
   * generated nesting rather than over the three examples anyone would write.
   *
   * The same construction is what CodeQL's `js/incomplete-multi-character-sanitization`
   * flags on this pattern even when the loop is present. The alert is a
   * catalogued false positive in this fleet; the property is why we are
   * entitled to call it one.
   */
  it('no tag survives, however the fragments are spliced', () => {
    const fragment = fc.oneof(
      fc.constantFrom(
        '<script>',
        '</script>',
        '<<script>script>',
        '<scr<script>ipt>',
        '<img src=x onerror=y>',
        '<style>',
        '</style>',
        '<div>',
        '<!-- -->',
        '<'
      ),
      fc.string({ maxLength: 12 })
    );
    fc.assert(
      fc.property(fc.array(fragment, { maxLength: 30 }), (parts) => {
        const { text } = htmlToText(parts.join(''), 1000);
        expect(text).not.toMatch(/<[^>]+>/);
      }),
      RUNS
    );
  });

  /**
   * Entity decoding cannot reconstruct markup.
   *
   * The order is what matters, and it was wrong here: entities were decoded
   * *after* the tag pass, so `&lt;script&gt;alert(1)&lt;/script&gt;` in a feed
   * came out as literal `<script>alert(1)</script>` in text an MCP client may
   * render as markdown. The same bug was found and fixed in freshrss-mcp; this
   * repository still had it. Stripping runs again after the single decode,
   * which is why doubly encoded text stays the text it is.
   */
  it('entities cannot rebuild a tag after stripping', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.constantFrom(
            '&lt;',
            '&gt;',
            '&#60;',
            '&#x3c;',
            '&#62;',
            '&amp;lt;',
            'script',
            '/script',
            '&amp;'
          ),
          { maxLength: 30 }
        ),
        (parts) => {
          const { text } = htmlToText(parts.join(''), 1000);
          expect(text).not.toMatch(/<[^>]+>/);
        }
      ),
      RUNS
    );
  });

  /**
   * The budget is `limit` characters of text plus the truncation marker.
   *
   * Stated as `limit + 1` rather than `limit` because that is what the function
   * does, here and in freshrss-mcp: the ellipsis is appended after the slice
   * rather than reserved inside it. mcp-hub's `clampBytes` reserves instead,
   * and it has to — a byte budget that overshoots is a different kind of wrong
   * from a character count that does.
   */
  it('respects its character limit, plus the truncation marker', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 5000 }),
        fc.integer({ min: 1, max: 500 }),
        (html, limit) => {
          const { text, truncated } = htmlToText(html, limit);
          expect(text.length).toBeLessThanOrEqual(limit + 1);
          if (text.length > limit) {
            expect(truncated).toBe(true);
            expect(text.endsWith('\u2026')).toBe(true);
          }
        }
      ),
      RUNS
    );
  });

  it('decodeXmlText is idempotent on text that decodes to no entity', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), (text) => {
        const once = decodeXmlText(text);
        fc.pre(!/&(#x?[0-9a-f]+|[a-z]+);/i.test(once));
        expect(decodeXmlText(once)).toBe(once);
      }),
      RUNS
    );
  });
});
