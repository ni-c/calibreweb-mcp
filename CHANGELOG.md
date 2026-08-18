# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

<!-- #region changelog -->

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

[0.1.1]: https://github.com/ni-c/calibreweb-mcp/releases/tag/v0.1.1
[0.1.0]: https://github.com/ni-c/calibreweb-mcp/releases/tag/v0.1.0

<!-- #endregion changelog -->
