# What is calibreweb-mcp?

[Calibre-Web](https://github.com/janeczku/calibre-web) is the self-hosted web UI
for a [Calibre](https://calibre-ebook.com) ebook library, and
[Calibre-Web Automated](https://github.com/crocodilestick/Calibre-Web-Automated)
is its actively extended fork. Both serve the same machine-readable interface:
an [OPDS](https://opds.io) catalog feed under `/opds`, built so e-reader apps can
browse and download books.

`calibreweb-mcp` puts that feed behind the
[Model Context Protocol](https://modelcontextprotocol.io), so an assistant can
answer "do we have anything by Le Guin?", pick something from a shelf, show a
cover, or hand you the EPUB download link — without you opening the web UI.

## Why not talk to the API directly?

Because there is no API. Calibre-Web has no REST endpoints; feature requests for
one have been open for years. What it has is the OPDS feed: Atom XML designed
for e-reader firmware, not for programs that want structured data.

| The feed gives you | These tools give you |
| --- | --- |
| Atom XML with three namespaces | JSON |
| `<id>urn:uuid:…</id>` and no numeric id anywhere | the numeric book id, extracted from the cover/download links |
| rating, series and tags rendered into an XHTML blob | `rating: 4`, `series: { name, index }`, `tags: […]` |
| the book comment as escaped HTML inside that blob | a plain-text summary, bounded per book and per response |
| root-relative hrefs | absolute download and cover URLs, locked to your instance's origin |
| a `rel="next"` link when more pages exist | `pagination.nextOffset` to pass back as `offset` |

## What it deliberately does not do

- **No writes.** The OPDS feed has none, and this server would not add any.
  There is nothing to configure to make it read-only — it is read-only by
  construction.
- **No file downloads.** Tools return download URLs per format; the model has no
  reason to pull an EPUB into its context. Covers are the one exception — they
  come back as real images your client can display.
- **No facet browsing.** Authors, series, tags and publishers exist as index
  feeds, but `search_books` covers those lookups; dedicated tools can be added
  if a real use case shows up.

## Next

- [Getting started](/guide/getting-started) — create a dedicated user and run the server
- [Connecting clients](/guide/clients) — Claude Code, Claude Desktop, Codex, Docker
- [Security](/guide/security) — what the credentials grant and how metadata is treated
