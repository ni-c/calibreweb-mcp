# Configuration

Four environment variables; the full reference table is at
[Reference → Environment variables](/reference/environment).

## The URL

`CALIBRE_WEB_URL` is the **root of the web UI** — the `/opds` path is appended
automatically:

```sh
CALIBRE_WEB_URL=https://books.example.com        # right
CALIBRE_WEB_URL=https://books.example.com/opds   # wrong
```

Subpath installations work: Calibre-Web emits hrefs that include its script
root, so `https://host.example/calibre` resolves correctly.

Rules the server enforces at startup:

- A URL that does not parse, uses a non-http(s) scheme, or **contains embedded
  credentials** (`https://user:pass@host`) is fatal — credentials belong in
  their own variables, never in a URL that ends up in logs.
- Plain `http://` to a non-loopback host only warns, but means the password
  crosses the network unencrypted. Use HTTPS.

## Credentials

`CALIBRE_WEB_USERNAME` and `CALIBRE_WEB_PASSWORD` are the **web login** of a
Calibre-Web account — Calibre-Web has no separate API tokens. They count as a
pair:

- both set → HTTP Basic auth on every request
- both unset → anonymous mode, for instances that allow anonymous browsing
- only one set → configuration error, reported on every call

The password is deleted from `process.env` immediately after being read, so
child processes and environment dumps do not see it.

## Self-signed certificates

`CALIBRE_WEB_INSECURE_TLS=true` accepts an invalid certificate — but only for
requests that go to the configured host, via a scoped TLS dispatcher. It never
sets `NODE_TLS_REJECT_UNAUTHORIZED`, so certificate validation for anything
else in the process stays intact.

## Pagination

Feeds are paginated by the instance's **Books per page** setting (default 60);
the page size is not client-controllable. Every listing returns a `pagination`
object — when `hasMore` is true, pass `nextOffset` as the `offset` of the next
call. The value is read from the feed's own `rel="next"` link, never computed.

Two exceptions:

- `list_books` with `view: "discover"` is a random selection and not paginated.
- `search_books` is not paginated server-side at all: Calibre-Web returns every
  match in one response. The tool caps the result client-side (`limit`, default
  50, max 200) and reports the real match count in `totalFound`.

## Response budgets

Everything that reaches the model is bounded:

| Layer | Limit |
| --- | --- |
| Feed body | 8 MB, refused while streaming |
| Cover image | 1 MB (Calibre-Web serves the full-size cover on this route) |
| Summary per book | 1 000 characters |
| Summaries per response | 30 000 characters shared budget |
| Any single tool result | 400 000 characters hard backstop |

Whenever a budget trims something, the result says so in `notes`.
