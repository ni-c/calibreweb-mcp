/**
 * The tools this server can register, declared rather than discovered.
 *
 * Declared, because the tool filter has to answer "is this a name you have?"
 * *before* the first tool is registered. `createServer` builds the filter on the
 * way in, so that an unusable `CALIBRE_WEB_ALLOW_TOOLS` fails at startup rather
 * than leaving a server running with tools quietly missing — and a catalogue
 * derived from what actually reached `registerTool` would still be empty at that
 * point. These names are also the half of the error that says which ones do
 * exist, and what the `essential` preset resolves against.
 *
 * This is also the full tool surface, hard-coded on purpose: a tool that appears
 * or disappears by accident is a change to the server's contract and has to be a
 * deliberate edit here. `test/tool-filter.test.ts` asserts that these lists and
 * the tools the server really registers are the same set.
 */

/** Every tool. This server never writes, so there is no split to make. */
export const ALL_TOOLS_LIST = [
  'get_cover',
  'get_shelf_books',
  'get_stats',
  'list_books',
  'list_shelves',
  'search_books',
] as const;

/** Every tool, read-only mode aside. */
export const ALL_TOOLS: readonly string[] = [...ALL_TOOLS_LIST];

/**
 * What `CALIBRE_WEB_ALLOW_TOOLS=essential` selects: find a book, see the shelves.
 *
 * 5 of 6. Left out on purpose: `get_cover`, which returns a base64 image that floods the context window
 * and is almost never the answer to a question.
 */
export const ESSENTIAL_TOOLS: readonly string[] = [
  'search_books',
  'list_books',
  'list_shelves',
  'get_shelf_books',
  'get_stats',
];
