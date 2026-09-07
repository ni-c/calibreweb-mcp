# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

<!-- #region changelog -->

## [0.3.1] - 2026-09-07

### Security

- Markup is taken out of a book description in one forward pass instead of by
  re-running a regular expression until the text stops changing. The old shape
  was quadratic in the input: a run of unclosed `<` bought one full rescan per
  character, and 16 096 of them — exactly what the content slice admits — cost
  168 ms **per book**, on the thread that serves every request, from anybody
  who can write a description into the library. A search answer carries
  hundreds of books. The scan never removes a `<` that could pair up with a
  later `>`, so one pass is the fixpoint by construction rather than by
  repetition, and every removal emits a separator so two halves cannot become
  one token. `test/linear-time.test.ts` holds it, and every other function that
  reads feed or configuration text, to a budget at the largest input the code
  accepts.
- The status of a response is decided before its body is read. Every verb read
  the body under the success ceiling first, so a 401 behind a reverse proxy
  answering with a two-megabyte login page surfaced as "returned a response
  larger than 1048576 bytes and was refused" — the size instead of the status,
  no hint about the credentials, and none of the handling that keys on 401 ever
  running. Error bodies now have their own 64 KiB ceiling that cuts instead of
  refusing.
- A refused login is remembered for ten seconds and repeated from memory rather
  than retried. Calibre-Web logs every refused OPDS login at warning level —
  `OPDS Login failed for user "%s" IP-address: %s`, the line intrusion
  detection filters on — and does not rate-limit them: the limiter call in its
  `verify_password` is commented out and the OPDS routes carry none. Every tool
  here is annotated read-only, idempotent and cheap, which is what a model
  retries after being told to check the credentials. The record is per process
  and says when the next real attempt is possible.
- A cover's media type is read from the image data instead of from the response
  header, and data matching none of the four signatures is refused. An HTML
  login page served with `image/png` reached the client as an image before.
  Reading the data is also what makes the reported type correct: Calibre names
  every cover file `cover.jpg` whatever the image is, and Calibre-Web guesses
  the header from that name — the integration fixtures are PNG files under that
  name, which is how a header-versus-data check was caught refusing legitimate
  covers.
- A character reference naming a surrogate decodes to U+FFFD, and every string
  is repaired after every cut. `String.fromCodePoint(0xd800)` answers half a
  character without complaining, and a summary or a field cut at its budget can
  split a pair — legal JSON on the wire that raises `UnicodeEncodeError` in a
  client encoding it to UTF-8.
- Startup diagnostics no longer print the value of `CALIBRE_WEB_URL`. A value
  that fails to parse is the one most likely to be a password pasted one line
  too high, and redacting userinfo does nothing for a bare one; it is now
  described by length unless it contains `://`. The scheme is no longer echoed
  either — a 56-character hexadecimal key with a colon after it is a valid URL
  whose scheme is the key.
- The publish job installs with `--ignore-scripts`. It holds an OIDC token for
  npm Trusted Publishing, and an install hook of any dependency would have run
  while that token was available. `mcp-publisher` is pinned to v1.8.1 with its
  published checksum instead of `releases/latest/download`, in both jobs that
  hold a token, and `gh release create` verifies the tag.
- Pull requests get a dependency review (`fail-on-severity: high`). `npm audit`
  checks the tree as it is; this checks the change.
- The runtime image drops yarn and corepack as well as npm, and no longer
  carries `package-lock.json`, which nothing reads at runtime.

### Fixed

- An id the feed states can no longer take a whole listing down. `Number` on an
  unbounded digit run answers `1e20` at twenty digits and `Infinity` at four
  hundred; `shapedBook.id` is `z.number()` and `pagination.nextOffset` is
  `z.number().int()`, both of which refuse those, and the SDK answers a schema
  violation with an error for the _entire_ call — so one poisoned entry in a
  page of fifty made every book in it unreachable, with a message naming no
  cause. Ids are now read as at most ten digits and must be safe integers
  inside the range Calibre-Web's own routes accept; anything else is reported
  as no id, with a note. The same for the next-page offset, which stops
  pagination rather than offering an offset nothing can use.
- A counter from `/opds/stats` that is not finite is dropped rather than
  answered. `typeof value === 'number'` was the whole check, and `1e999` in the
  JSON parses to `Infinity`, which passes it and fails the output schema.
- One entry can no longer make a listing unanswerable. A metadata field is cut
  at 1000 characters and the authors, tags, languages and formats one entry
  contributes are capped, each with a note; a link longer than 2048 characters
  is dropped. The result ceiling drops summaries and then refuses, so a
  megabyte title — which is not a summary — used to answer "narrow the request"
  for every offset that paged over that book, and no narrowing helped.
- The result ceiling measures the text that is actually sent. It measured the
  compact serialisation and emitted the indented one, which is two to three
  times as many characters, so the limit held for a string nobody received.
- An upstream error body is labelled as untrusted text from the instance and
  cut at 200 characters rather than 2000.
- `CALIBRE_WEB_URL` is stored as the parsed origin and path rather than as the
  environment string, so a query or fragment cannot be glued in front of every
  request path; trailing slashes come off with an index walk rather than a
  pattern that is retried from every position of the run.

### Added

- The server introduces itself in full. `title`, `description`, `websiteUrl` and
  `icons` now travel with `name` and `version`, so a client that shows a server
  to a person has something to show. All four were already in `server.json` for
  the registry and reached no client at all; a test compares the two so they
  cannot drift.
- Server `instructions`. Results carry an `untrusted` marker, but that is read
  after the fact — this is the channel a model sees before it calls anything.
- An OpenSSF Scorecard run, weekly and on every push to `main`, reporting into
  the Security tab next to CodeQL and Trivy. The badge is the second in the row.
- A property test drives every feed-reading tool through a connected client over
  feeds built from hostile field values, and asserts that no answer carries
  `Output validation error`, `Cannot read properties` or `is not a function`,
  and that both channels always agree. It reproduced the id defect above on its
  first run. `SHAPE_RUNS` raises the run count for a deep local pass.
- The test client now calls `tools/list` once before every suite, so the
  client-side schema check runs on every success path rather than only on the
  paths a test happened to list on. A test drives the insecure-TLS switch,
  which had never had one.

### Changed

- oxlint's `suspicious` category is on; 22 findings fixed (mostly
  `Array#toSorted()` over copy-and-sort and un-shadowed names). No runtime
  behaviour changed.
- The tool reference marks the `essential` preset and the tools that ask a
  person before they act, per tool rather than only in the introduction. A test
  keeps both sets in step with the code.
- `homepage` in `package.json` points at the documentation site rather than at
  the README anchor on GitHub. It is what npm shows next to the package, and
  every one of these servers has had a documentation site for weeks.
- Source maps are no longer published in the npm tarball. Node reads them only
  under `--enable-source-maps`, which nothing here sets, and the maps pointed at
  a `src/` this package does not ship — so a stack trace under that flag named a
  file nobody could open. `dist/**/*.js` is unchanged; the package is about a
  fifth smaller.
- `letter` and `offset` carry ceilings, and `tsconfig.json` targets the ES2024
  library for `String#toWellFormed`.

## [0.3.0] - 2026-09-03

### Added

- Every tool declares an `outputSchema` and answers with `structuredContent`
  beside the text block. A client no longer has to parse prose to use a result.

  The untrusted-content warning travels with it as `untrusted: true` and
  `source: "calibre-web"` fields, not only as a line in `notes` — a client that
  reads the structured half should be able to check the framing rather than
  find it in a list of sentences. `get_stats` and `get_cover` do not carry it:
  four counters checked to be numbers, and an id with a media type from a
  four-entry allowlist.

  What comes out of an OPDS feed is described exactly, because this server
  shapes every field of it itself rather than passing the document on. The book
  and feed types are now derived from those schemas, so the two cannot drift —
  a drift would have surfaced as a failed tool call rather than a type error.

### Changed

- The advertised schemas avoid a spelling that is legal JSON Schema and still
  gets a tool refused, or its constraint silently dropped, by some MCP clients:
  a nullable field is written as `anyOf` branches rather than `"type":
["string", "null"]`, which several clients read as a single type and then
  drop. What the tools accept and return is unchanged; only the way the schema
  says so is.

- A result that is still over the ceiling after book summaries are dropped is
  now an **error** rather than JSON cut at the ceiling. The truncated form was
  unparseable, which a text block tolerates and `structuredContent` cannot —
  and the two channels have to carry the same value.

- Runs on **MCP SDK 2.0**. Existing clients see the same protocol revision they
  always did; the change is the package layout behind it.

- The linter is **oxlint** instead of eslint plus typescript-eslint, which
  lifts the TypeScript ceiling: typescript-eslint pins `typescript` below 6.1,
  so this repository was held on TypeScript 6 by its linter rather than by its
  code.

- The tool filter, the host classifier and the documentation-asset generator
  now come from **`mcp-tool-allowlist`**, **`mcp-internal-hosts`** and
  **`svg-asset-set`** rather than from copies kept here — 674 fewer lines, and
  one place to fix each. None of them has a runtime dependency of its own.

- stdio is served through `serveStdio`, so the connection's era is negotiated
  on the opening exchange rather than assumed. A client that pins the
  `2026-07-28` era is served it; until now its `server/discover` probe was
  answered with "Method not found" and only `2025-11-25` was on offer. A client
  that speaks the older era sees no change — it is still pinned to one instance
  for the life of the connection, exactly as a hand-wired
  `StdioServerTransport` served it.

### Fixed

- **Four output fields no longer carry control characters into the model
  context.** `uuid`, `published`, `updated` and a format's `mimeType` reached
  the result verbatim while `title`, `authors`, `publisher`, `languages`,
  `tags`, `format` and `series` were being cleaned — so the assurance in
  `decodeXmlText`'s docstring, that library metadata is safe for the model and
  for any terminal rendering it, did not hold for them. A BiDi override such as
  U+202E reverses the display order of everything after it, which is the
  Trojan-Source trick; `uuid` in particular is a plain text column in Calibre,
  and an imported `metadata.db` fills it with whatever it likes.

  The strip now happens in `optionalText`, the funnel every plain metadata field
  already goes through, rather than field by field — a guard that has to be
  remembered per field is a guard that gets forgotten, which is exactly how
  these four were missed.

- An entry in `CALIBRE_WEB_ALLOW_TOOLS` that is not tool-name-shaped is now
  **redacted** in the error rather than quoted back. `CALIBRE_WEB_PASSWORD` and
  `CALIBRE_WEB_ALLOW_TOOLS` are adjacent lines in every compose file, and a
  paste into the wrong one used to print the credential into the client's log.

## [0.2.0] - 2026-08-27

### Added

- `CALIBRE_WEB_ALLOW_TOOLS` and `CALIBRE_WEB_DENY_TOOLS` choose which of the 6
  tools are registered. Both take comma-separated tool names or a prefix with a
  trailing `*`, the allow list decides what is in and the deny list is subtracted
  from it, and `CALIBRE_WEB_ALLOW_TOOLS=essential` selects a curated five —
  `search_books`, `list_books`, `list_shelves`, `get_shelf_books`, `get_stats`. A model picks the right tool far more reliably from five than
  from six, and every visible tool costs context on every request. Nothing
  changes for an installation that sets neither.

  A filtered tool is not registered at all, so it is absent from `tools/list`
  and answers `tools/call` with "tool not found".

  An entry that matches no tool **stops the server at startup**, naming the
  entry and listing the real names, rather than being ignored: an ignored typo
  leaves a tool missing from `tools/list` with nothing pointing at the cause.

### Changed

- The README now carries the same eight badges, in the same order, as every other
  MCP server in this family, all of them reading from npm rather than hard-coded;
  the opening follows one shape; and the standalone "Full documentation" line is
  gone, because the docs badge three lines above it points at the same page.

### Fixed

- The container image no longer ships OpenSSL 3.5.7-r0, which carries
  **CVE-2026-14456** (denial of service via unbounded memory growth). The pinned
  `node:24-alpine` digest is already the newest one; Alpine's fixed 3.5.8-r0 has
  simply not been rebuilt into it yet, so the runtime stage now upgrades
  `libcrypto3` and `libssl3` by name. Upgrading those two rather than running a
  blanket `apk upgrade` keeps the rest of the image exactly as the digest pins
  it. The step can go once the base image ships the fix.

## [0.1.3] - 2026-08-26

### Changed

- The check that decides whether `CALIBREWEB_URL` points somewhere local — and
  therefore whether sending a credential over plain `http` is worth warning
  about — now uses the same host classifier as the other MCP servers in this
  family, in `src/hosts.ts`. The string comparison it replaces missed several
  spellings of the same address: `http://[::ffff:127.0.0.1]`, which `URL`
  canonicalises to `[::ffff:7f00:1]` before any check sees it, and `localhost.`
  with its root label. It also treated `127.example.com` as loopback, because it
  matched on the `127.` prefix, and so stayed quiet about a plain-http URL to a
  public host.

Nothing else changes: this server has no tool that takes a URL, so there is no
request whose target a caller can choose.

## [0.1.2] - 2026-08-19

### Fixed

- Tag stripping in summaries now runs to a fixpoint, so overlapping constructs
  like `<<script>script>` can no longer reassemble into markup
  (CodeQL `js/incomplete-multi-character-sanitization`). Defense-in-depth: the
  output is plain text, but an MCP client rendering results as markdown could
  have interpreted leftover HTML.

## [0.1.1] - 2026-08-19

### Added

- Documentation site at [calibreweb-mcp.ni-c.de](https://calibreweb-mcp.ni-c.de)
  with a full tools reference and a reproducible demo recording (the demo runs
  against a bundled fixture library, no Calibre-Web instance needed).
- Release pipeline: npm publishing via Trusted Publishing with provenance,
  GitHub releases from the changelog, MCP registry submission, and a multi-arch
  container image on GHCR with SBOM and build provenance.

## [0.1.0] - 2026-08-19

### Added

- Initial release: read-only MCP server for Calibre-Web via its OPDS feed.
- Tools: `search_books`, `list_books` (new/hot/rated/discover/read/unread/all),
  `list_shelves`, `get_shelf_books`, `get_cover` (image content), `get_stats`.
- HTTP Basic auth with support for anonymous-browsing instances.
- Hardened XML pipeline: DOCTYPE/entity refusal, no entity processing, bounded
  response bodies, control-character stripping, credential redaction.

[0.3.1]: https://github.com/ni-c/calibreweb-mcp/releases/tag/v0.3.1
[0.3.0]: https://github.com/ni-c/calibreweb-mcp/releases/tag/v0.3.0
[0.2.0]: https://github.com/ni-c/calibreweb-mcp/releases/tag/v0.2.0
[0.1.3]: https://github.com/ni-c/calibreweb-mcp/releases/tag/v0.1.3
[0.1.2]: https://github.com/ni-c/calibreweb-mcp/releases/tag/v0.1.2
[0.1.1]: https://github.com/ni-c/calibreweb-mcp/releases/tag/v0.1.1
[0.1.0]: https://github.com/ni-c/calibreweb-mcp/commit/977ef347

<!-- #endregion changelog -->
