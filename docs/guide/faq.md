# FAQ & troubleshooting

## Does this work with Calibre-Web Automated?

Yes. CWA keeps Calibre-Web's OPDS feed unchanged; everything here works the
same way against it.

## Why do some books have `id: null`?

The OPDS entry itself carries only a UUID — the numeric Calibre id exists
nowhere in it except inside the cover and download link hrefs. A book with no
cover, requested by a user without the Download role, has neither link, so
there is nothing to extract. The UUID is still returned; only `get_cover` is
unavailable for that book (grant the Download role to fix it).

## `HTTP 401` on every call

Wrong `CALIBRE_WEB_USERNAME` / `CALIBRE_WEB_PASSWORD`. The OPDS feed uses the
normal **web login** of the account — Calibre-Web has no separate API password.
A 401 on a download URL specifically means the user lacks the **Download**
role.

## `HTTP 403` on `view: "read"` / `"unread"`

Those feeds require a non-anonymous user with **Show Read and Unread** enabled
in the user's view settings.

## `HTTP 404` on a view that should exist

Calibre-Web hides feeds according to the user's sidebar visibility settings
(**Admin → Edit User → View**). A 404 on `hot`, `rated` or `discover` usually
means that section is switched off for the configured user — or
`CALIBRE_WEB_URL` does not point at the instance root.

## "returned an HTML page instead of an Atom feed"

The URL points somewhere that answers with HTML — typically the instance root
is wrong, or a reverse proxy in front of Calibre-Web served its own login page.
The server refuses to parse HTML rather than producing a confusing XML error.

## Why can't I change the page size?

It is a server-side setting (**Admin → UI Configuration → Books per page**,
default 60). The OPDS feed paginates by it and offers no per-request override.
Follow `pagination.nextOffset` instead of assuming a size.

## A broad search fails with "larger than 8388608 bytes"

Calibre-Web returns **every** search match in a single response; on a huge
library a one-letter query can exceed the 8 MB feed cap. Narrow the query —
the cap is what keeps a hostile or misconfigured instance from exhausting
memory.

## Why is the cover so big / refused over 1 MB?

Calibre-Web serves the **full-size** cover on the OPDS cover route (the
thumbnail aliases exist for client compatibility but serve the same file).
`get_cover` refuses anything over 1 MB to protect the context window — for a
larger scan, open the book's `coverUrl` in a browser instead.

## Can it add books, edit metadata, or manage shelves?

No, and it will not. The OPDS feed is read-only; writing would mean driving
Calibre-Web's session-based HTML forms, which is a different (and much more
fragile) project. Every tool is a GET.

## Where are the author / series / tag browsing tools?

`search_books` matches against title, authors, series, publisher and tags, which
covers those lookups in practice. The index feeds exist in Calibre-Web, so
dedicated tools are easy to add —
[open an issue](https://github.com/ni-c/calibreweb-mcp/issues) with the use
case.

## One tool I expected is missing

Something narrowed the list. In order of likelihood:

- `CALIBRE_WEB_ALLOW_TOOLS` is set and does not name it — it is an allow list, so
  anything not named is out.
- `CALIBRE_WEB_DENY_TOOLS` names it, possibly through a prefix such as `list_*`.

A filtered tool is not registered at all, so it is missing from `tools/list` and
answers `tools/call` with "tool not found". There is no state where it is hidden
but still callable.

What it is _not_ is a typo in one of those variables: an entry that matches no
tool stops the server at startup and says which entry it was. See
[choosing the tools that load](/guide/configuration#choosing-the-tools-that-load).
