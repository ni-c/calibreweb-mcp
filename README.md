# calibreweb-mcp

[![CI](https://img.shields.io/github/actions/workflow/status/ni-c/calibreweb-mcp/ci.yml?branch=main&label=CI)](https://github.com/ni-c/calibreweb-mcp/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/calibreweb-mcp)](https://www.npmjs.com/package/calibreweb-mcp)
[![node](https://img.shields.io/node/v/calibreweb-mcp)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/calibreweb-mcp)](LICENSE)
[![container](https://img.shields.io/badge/ghcr.io-ni--c%2Fcalibreweb--mcp-2496ed?logo=docker&logoColor=white)](https://github.com/ni-c/calibreweb-mcp/pkgs/container/calibreweb-mcp)
[![docs](https://img.shields.io/badge/docs-calibreweb--mcp.ni--c.de-4f46e5)](https://calibreweb-mcp.ni-c.de)

A read-only [Model Context Protocol](https://modelcontextprotocol.io) server for
[Calibre-Web](https://github.com/janeczku/calibre-web) (and
[Calibre-Web Automated](https://github.com/crocodilestick/Calibre-Web-Automated)),
the self-hosted ebook library web UI.

Calibre-Web has no REST API — its only stable machine-readable interface is the
OPDS catalog feed it serves for e-reader apps. This server speaks that feed:
Atom XML with HTTP Basic auth in, structured book data out. Search the library,
browse the curated views and shelves, follow per-format download links, and pull
cover images straight into the conversation. It never writes anything: every
tool is a GET against the OPDS routes.

<!-- <picture> is resolved against the colour scheme of the page showing it, so GitHub
     picks the variant that matches its own theme toggle. npm strips <picture> and
     <source> when it sanitises the README and keeps the <img>, which is why that
     fallback brings its own dark card instead of relying on a media query. -->
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://calibreweb-mcp.ni-c.de/architecture-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="https://calibreweb-mcp.ni-c.de/architecture-light.svg">
  <img src="https://calibreweb-mcp.ni-c.de/architecture.svg" alt="An MCP client speaks stdio to calibreweb-mcp, which reads the OPDS feed of Calibre-Web over HTTPS with Basic auth" width="800">
</picture>

<!-- Recorded with vhs from docs/demo.tape against the bundled fixture library
     (docs/demo-server.mjs) — no Calibre-Web instance needed to reproduce it. -->

![Demo: listing the tools, searching the library and reading the stats through the MCP Inspector CLI](https://calibreweb-mcp.ni-c.de/demo.gif)

**📖 Full documentation: [calibreweb-mcp.ni-c.de](https://calibreweb-mcp.ni-c.de)**

## Requirements

- Node.js 22 or newer
- A Calibre-Web instance (developed against the current
  `linuxserver/calibre-web` image; Calibre-Web Automated works the same way)
- A Calibre-Web user for the server. The OPDS feed authenticates with the
  normal web login — use a **dedicated account with only the View and Download
  roles**, not your admin account. If the instance allows anonymous browsing,
  the server can also run without credentials.

## Configuration

| Variable                   | Required | Description                                                                                             |
| -------------------------- | -------- | ------------------------------------------------------------------------------------------------------- |
| `CALIBRE_WEB_URL`          | yes      | Root URL of the instance, e.g. `https://books.example.com`. The `/opds` path is appended automatically. |
| `CALIBRE_WEB_USERNAME`     | yes¹     | Username of the Calibre-Web account.                                                                    |
| `CALIBRE_WEB_PASSWORD`     | yes¹     | Password of that account (the web login password).                                                      |
| `CALIBRE_WEB_INSECURE_TLS` | no       | `true` to accept self-signed certificates — scoped to the configured host only.                         |

¹ Leave **both** unset for an instance that allows anonymous browsing; setting
only one of them is a configuration error.

### Claude Code

```sh
claude mcp add calibreweb \
  -e CALIBRE_WEB_URL=https://books.example.com \
  -e CALIBRE_WEB_USERNAME=reader \
  -e CALIBRE_WEB_PASSWORD=... \
  -- npx calibreweb-mcp
```

### Claude Desktop

```json
{
  "mcpServers": {
    "calibreweb": {
      "command": "npx",
      "args": ["calibreweb-mcp"],
      "env": {
        "CALIBRE_WEB_URL": "https://books.example.com",
        "CALIBRE_WEB_USERNAME": "reader",
        "CALIBRE_WEB_PASSWORD": "..."
      }
    }
  }
}
```

### Codex

```toml
[mcp_servers.calibreweb]
command = "npx"
args = ["calibreweb-mcp"]
env = { CALIBRE_WEB_URL = "https://books.example.com", CALIBRE_WEB_USERNAME = "reader", CALIBRE_WEB_PASSWORD = "..." }
```

## Tools

All tools are read-only (`readOnlyHint: true`).

| Tool              | Description                                                                                                                                                                            |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search_books`    | Search by title, author, series, publisher and tags. Calibre-Web returns every match at once; the result is capped client-side (`limit`, default 50) and reports the real match count. |
| `list_books`      | Book listings by view: `new` (default), `hot`, `rated`, `discover` (random), `read`, `unread`, or `all` (optionally narrowed to an initial letter).                                    |
| `list_shelves`    | Public shelves plus the configured user's own shelves.                                                                                                                                 |
| `get_shelf_books` | The books on a shelf, in shelf order.                                                                                                                                                  |
| `get_cover`       | A book's cover, returned as an image the client can display.                                                                                                                           |
| `get_stats`       | Total books, authors, categories and series.                                                                                                                                           |

Book entries include authors, tags, series (with index), rating, a bounded
summary, a cover URL and per-format download URLs — ready-made links a human can
open, since the model itself has no reason to download an EPUB.

### Pagination

Feeds are paginated by the instance's _books per page_ setting (default 60); the
page size is not client-controllable. Every listing returns
`pagination.nextOffset` when more pages exist — pass it as `offset` in the next
call. The `discover` view is a random selection and not paginated.

### Deliberately out of scope

- **No writes.** The OPDS feed has none, and this server would not add any.
- **No file downloads.** Tools return download URLs, not ebook payloads.
- **No facet browsing** (authors/series/tags/publishers/languages/formats as
  their own index feeds). `search_books` covers those lookups; the routes exist
  and tools for them can be added if there is a real use case.

## Safety

- The server is read-only by construction — GET requests only, no state anywhere.
- Book metadata is untrusted third-party data; every result says so, control
  characters are stripped, and XML entity processing is disabled (documents
  declaring a DOCTYPE or entities are refused outright).
- Responses are bounded before parsing (8 MB feeds, 1 MB covers) and again
  before they reach the model (per-book and per-response budgets).
- Feed hrefs are only passed through when they resolve to the configured
  origin over http(s) — a hostile feed cannot plant `javascript:`, `file:` or
  cross-origin URLs into the results.
- Redirects are refused so the Basic credentials can never be replayed to
  another host; covers are only passed through for real image content types.
- The password is scrubbed from the process environment at startup, and URLs
  are credential-redacted before they appear in any log or result.

## Container

```sh
docker run -i --rm \
  -e CALIBRE_WEB_URL=https://books.example.com \
  -e CALIBRE_WEB_USERNAME=reader \
  -e CALIBRE_WEB_PASSWORD=... \
  ghcr.io/ni-c/calibreweb-mcp
```

## Development

```sh
npm install
npm test            # unit tests against a stubbed OPDS feed, no instance needed
npm run lint
npm run build
```

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Releasing

1. Update `CHANGELOG.md` and bump the version in `package.json` (+ lockfile).
2. `npm run lint && npm run test:coverage && npm run build`
3. Tag the release: `git tag -s vX.Y.Z -m "vX.Y.Z" && git push origin vX.Y.Z`

## License

[MIT](LICENSE)
