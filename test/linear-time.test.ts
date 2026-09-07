import { describe, expect, it, vi } from 'vitest';

import { loadConfig } from '../src/config.js';
import { redactUrlCredentials } from '../src/redact.js';
import {
  Notes,
  absolutize,
  htmlToText,
  parseContentBlob,
  shapeFeed,
} from '../src/shape.js';

/**
 * Every function that reads attacker-chosen text, timed at the largest input
 * the code will actually accept.
 *
 * The sizes are computed from the ceilings in the source rather than picked:
 * `parseContentBlob` slices the content blob at `SUMMARY_CHARS * 12 + 4096`,
 * so 16 096 characters is what one book description can buy, and the search
 * feed can carry hundreds of books in one answer. `CALIBRE_WEB_URL` has no
 * ceiling at all, so 80 000 is the fleet's usual probe size.
 *
 * The budget is deliberately one number per form rather than a ratio: a ratio
 * needs three runs and is the flakier thing to assert on a shared CI runner.
 * The curve was read by hand when the finding was made — the markup stripper
 * cost 14 ms, 55 ms and 168 ms at a quarter, a half and the whole ceiling,
 * and the trailing-slash rewrite 99 ms, 405 ms and 1617 ms at 20k, 40k and
 * 80k. Both are flat now, and 50 ms is far enough above the noise to be
 * stable and far enough below the old numbers to catch a regression.
 */
const BUDGET_MS = 50;

/** The content slice `parseContentBlob` admits, computed, not guessed. */
const CONTENT_CEILING = 1000 * 12 + 4096;

function timed(run: () => unknown): number {
  const started = performance.now();
  run();
  return performance.now() - started;
}

describe('markup stripping is linear in its own trigger', () => {
  const forms: Record<string, string> = {
    // One `<` per character, none of them ever closed: the old fixpoint loop
    // bought a whole rescan of the string per round, and this is the input
    // that maximises the rounds.
    'a run of unclosed angle brackets': '<'.repeat(CONTENT_CEILING),
    // The same run behind a real tag, so the first pass has something to
    // remove and the loop is entered at all. This was the worst measured
    // case at 239 ms.
    'a tag followed by the run': `<b>${'<'.repeat(CONTENT_CEILING - 3)}`,
    'a run of opening script tags': '<script>'.repeat(CONTENT_CEILING / 8),
    'script tags that never close': '<script '.repeat(CONTENT_CEILING / 8),
    'a run of style tags': '<style>'.repeat(CONTENT_CEILING / 7),
    // Escaped, because the second stripping pass runs on decoded text and a
    // run of `&lt;` becomes a run of `<` before it.
    'an escaped run': `${'&lt;'.repeat(CONTENT_CEILING / 4)}a>`,
    'nested brackets': `${'<'.repeat(CONTENT_CEILING / 2)}<>${'>'.repeat(
      CONTENT_CEILING / 2 - 3
    )}a>`,
    'many complete elements': '<b>'.repeat(CONTENT_CEILING / 3),
  };

  for (const [name, input] of Object.entries(forms)) {
    it(`stays under the budget on ${name}`, () => {
      const elapsed = timed(() =>
        parseContentBlob(input, { left: 30_000 }, new Notes())
      );
      expect(elapsed).toBeLessThan(BUDGET_MS);
    });
  }

  it('stays under the budget on a whole feed of the worst case', () => {
    // Twenty books, each carrying the worst form, is what a search answer
    // looks like when one person has been writing descriptions.
    const blob = `<b>${'<'.repeat(CONTENT_CEILING - 3)}`;
    const elapsed = timed(() => {
      const budget = { left: 30_000 };
      const warnings = new Notes();
      for (let i = 0; i < 20; i += 1) parseContentBlob(blob, budget, warnings);
    });
    expect(elapsed).toBeLessThan(BUDGET_MS * 4);
  });

  it('strips a long run without leaving an element behind', () => {
    const { text } = htmlToText(`<b>${'<'.repeat(5000)}x`, 200);
    expect(text).not.toMatch(/<[^>]+>/);
  });
});

describe('the configured URL is read in linear time', () => {
  it('trims a long run of trailing slashes under the budget', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const url = `https://books.example.net/${'/'.repeat(80_000)}api`;
    const elapsed = timed(() =>
      loadConfig({
        CALIBRE_WEB_URL: url,
        CALIBRE_WEB_USERNAME: 'u',
        CALIBRE_WEB_PASSWORD: 'p',
      })
    );
    expect(elapsed).toBeLessThan(BUDGET_MS);
    vi.restoreAllMocks();
  });

  it('redacts a long value under the budget', () => {
    const elapsed = timed(() =>
      redactUrlCredentials(`https://${'a'.repeat(80_000)}`)
    );
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });
});

describe('feed hrefs are read in linear time', () => {
  it('reads a long subsection href under the budget', () => {
    const href = `${`/${'1'.repeat(50)}`.repeat(1600)}x`;
    const parsed = {
      feed: {
        entry: [
          { title: 'x', link: [{ '@_rel': 'subsection', '@_href': href }] },
        ],
      },
    };
    const elapsed = timed(() =>
      shapeFeed(parsed, 'https://books.example.net', 0, new Notes())
    );
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });

  it('refuses a href past the URL ceiling instead of resolving it', () => {
    const href = `/opds/cover/${'1'.repeat(80_000)}`;
    const elapsed = timed(() => absolutize(href, 'https://books.example.net'));
    expect(absolutize(href, 'https://books.example.net')).toBeUndefined();
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });
});
