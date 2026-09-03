# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

<!-- #region changelog -->

## [Unreleased]

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

[0.1.2]: https://github.com/ni-c/calibreweb-mcp/releases/tag/v0.1.2
[0.1.1]: https://github.com/ni-c/calibreweb-mcp/releases/tag/v0.1.1
[0.1.0]: https://github.com/ni-c/calibreweb-mcp/releases/tag/v0.1.0

<!-- #endregion changelog -->
