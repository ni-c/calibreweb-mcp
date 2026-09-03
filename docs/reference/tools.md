# Tools

All six are registered unless you say otherwise. `CALIBRE_WEB_ALLOW_TOOLS` and
`CALIBRE_WEB_DENY_TOOLS` narrow the list to the ones you want, and `essential` selects a
curated five — see
[choosing the tools that load](/guide/configuration#choosing-the-tools-that-load).

Six tools, all read-only (`readOnlyHint: true`). Every result that carries
library data includes a `notes` array — budget truncations, dropped links and
the untrusted-data marker all land there.

Every tool declares an `outputSchema` and answers with `structuredContent`
beside the text block, so a client can use a result without parsing prose. The
untrusted-content warning travels with it as `untrusted: true` and
`source: "calibre-web"` fields, so it can be checked rather than looked for in
`notes`. Two tools do not carry it: `get_stats`, which is four counters this
server has checked are numbers, and `get_cover`, which reports an id, a media
type from a four-entry allowlist and a byte count — the image itself stays in
the content block where a client renders it.

Because this server shapes every field out of the OPDS document rather than
passing the document on, the schemas describe the result exactly. The book and
feed types are derived from them, so the two cannot drift.

## Book objects

Book-listing tools return entries of this shape (absent fields are omitted):

```json
{
  "id": 42,
  "uuid": "2853dacf-ed79-42f5-8e8a-a7bb3d1ae6a2",
  "title": "Dune",
  "authors": ["Frank Herbert"],
  "publisher": "Ace",
  "published": "1965-08-01T00:00:00+00:00",
  "languages": ["eng"],
  "tags": ["Science Fiction"],
  "series": { "name": "Dune Saga", "index": 1 },
  "rating": 5,
  "summary": "Plain text, capped at 1000 characters…",
  "coverUrl": "https://books.example.com/opds/cover/42",
  "formats": [
    {
      "format": "EPUB",
      "mimeType": "application/epub+zip",
      "size": 8552633,
      "downloadUrl": "https://books.example.com/opds/download/42/epub/"
    }
  ],
  "updated": "2026-01-07T13:54:01+00:00"
}
```

`id` is `null` when the entry has neither a cover nor a download link — see the
[FAQ](/guide/faq#why-do-some-books-have-id-null).

## search_books

Searches the library by title, author, series, publisher and tags.

| Parameter | Type | Description |
| --- | --- | --- |
| `query` | string, required | Search term (max 500 characters) |
| `limit` | integer | Maximum books returned (default 50, max 200) |

Calibre-Web returns **every** match in one response, so the result is capped
client-side; `totalFound` reports the real match count and `truncated` says
whether the cap applied.

## list_books

Book listings by view.

| Parameter | Type | Description |
| --- | --- | --- |
| `view` | enum | `new` (default), `hot`, `rated`, `discover`, `read`, `unread`, `all` |
| `letter` | string | Only with `all`: a single initial letter/digit, or `00` for every title (default) |
| `offset` | integer | Pagination offset; use `pagination.nextOffset` from the previous call |

Views: `new` = recently added, `hot` = most downloaded, `rated` = rated above
4.5 stars, `discover` = random (ignores `offset`), `read`/`unread` = the
configured user's reading state (needs a non-anonymous user with the
read/unread sidebar section enabled), `all` = the whole library ordered by
title.

## list_shelves

Lists the shelves visible to the configured user: every public shelf plus the
user's own private ones.

| Parameter | Type | Description |
| --- | --- | --- |
| `offset` | integer | Pagination offset |

Returns `{ id, name, isPublic? }` items. `isPublic` is only reported on
English-locale instances — Calibre-Web marks public shelves with a localized
title suffix.

## get_shelf_books

The books on a shelf, in the shelf's own order.

| Parameter | Type | Description |
| --- | --- | --- |
| `shelf_id` | integer, required | Shelf id from `list_shelves` |
| `offset` | integer | Pagination offset |

An empty result can also mean the shelf does not exist or is not accessible —
Calibre-Web returns an empty feed rather than an error in that case (the
result's `notes` say so).

## get_cover

Fetches a book's cover and returns it as an **image content block** the client
can display.

| Parameter | Type | Description |
| --- | --- | --- |
| `book_id` | integer, required | Numeric book id from any book-listing tool |

Calibre-Web serves the full-size cover on this route; images over 1 MB are
refused to protect the context window — use the book's `coverUrl` out-of-band
instead. Only JPEG, PNG, GIF and WebP pass through.

## get_stats

No parameters. Returns the library totals:

```json
{ "books": 707, "authors": 562, "categories": 147, "series": 9 }
```
