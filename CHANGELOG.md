# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

<!-- #region changelog -->

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
