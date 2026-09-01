# Contributing

Thanks for taking the time. Small, focused changes with tests land fastest.

## Development setup

```sh
git clone https://github.com/ni-c/calibreweb-mcp.git && cd calibreweb-mcp
npm install
npm test          # unit tests against a stubbed Calibre-Web OPDS feed, no instance needed
npm run build
```

## Running the integration suite

The unit tests stub the OPDS feed, so the documents they parse are documents
this repository wrote — they agree with its own reading of the format by
construction. This server's whole job is parsing XML somebody else produced, so
the integration suite spawns the built server over stdio against a throwaway
Calibre-Web in Docker and calls **every tool in the catalogue** against Atom
that Calibre-Web generated.

```sh
npm run build     # the suite runs dist/index.js, not src/
docker compose -f test/integration/compose.yml up -d
npm run test:integration
docker compose -f test/integration/compose.yml down -v
```

`down -v` matters: Calibre-Web keeps its own configuration in a volume and the
bootstrap runs its first-start wizard, which is only offered once.

Three things worth knowing before changing any of this:

- **The library is a fixture in the repository**, at `test/integration/library`
  — three books, about 450 kB, mounted read-only. A Calibre library cannot
  create itself: the schema in `metadata.db` carries triggers that call
  Calibre's own `title_sort` and `uuid4` SQL functions, so building one at run
  time would mean reimplementing them.
- **Calibre-Web has no API for its own setup.** The first run redirects
  everything to `/admin/dbconfig`, which is a browser form behind a login, so
  `bootstrap.ts` does what a browser would: log in, read the CSRF token out of
  the page, post the library path back.
- **`/shelf/add/{shelf}/{book}` wants the CSRF token in an `X-CSRFToken`
  header**, not as a form field, and answers 400 without it — which reads like
  a bad book id. Two conventions in one application.

For poking at one tool by hand, the inspector against the same stack:

```sh
docker compose -f test/integration/compose.yml up -d
CALIBRE_WEB_URL=http://127.0.0.1:8083 CALIBRE_WEB_USERNAME=admin \
  CALIBRE_WEB_PASSWORD=admin123 \
  npx @modelcontextprotocol/inspector node dist/index.js
```

## Expectations

- **Tests.** Behaviour changes come with a test that fails without the change.
  CI runs the test matrix on Node 22 and 24, npm audit, CodeQL and a Trivy
  container scan.
- **Comments** explain constraints the code cannot show — not what the next line does.
- **Security-sensitive areas** (config parsing, XML parsing, anything that builds a
  request URL): please describe the attack you are defending against, or the one
  your change might open, in the PR text.
- **No new runtime dependencies** without a very good reason; the small tree is a
  feature.
- Run `npm run lint` before pushing — it checks both oxlint and prettier, and prettier
  also validates the YAML, JSON and Markdown files.

## Questions and bugs

- Questions and ideas → [Discussions](https://github.com/ni-c/calibreweb-mcp/discussions)
- Reproducible problems → [Issues](https://github.com/ni-c/calibreweb-mcp/issues)
- Vulnerabilities → [private reporting](https://github.com/ni-c/calibreweb-mcp/security/advisories/new),
  never a public issue — see [SECURITY.md](SECURITY.md)
