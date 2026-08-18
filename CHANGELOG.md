# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

<!-- #region changelog -->

## [Unreleased]

### Added

- Initial release: read-only MCP server for Calibre-Web via its OPDS feed.
- Tools: `search_books`, `list_books` (new/hot/rated/discover/read/unread/all),
  `list_shelves`, `get_shelf_books`, `get_cover` (image content), `get_stats`.
- HTTP Basic auth with support for anonymous-browsing instances.
- Hardened XML pipeline: DOCTYPE/entity refusal, no entity processing, bounded
  response bodies, control-character stripping, credential redaction.

<!-- #endregion changelog -->

[Unreleased]: https://github.com/ni-c/calibreweb-mcp/commits/main
