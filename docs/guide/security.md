# Security

## Trust model

The credentials are the web login of a Calibre-Web user. Compromising them
grants whatever that account may do in the web UI — this server only ever reads
the OPDS feed, but the credentials themselves are not limited to that. So:

- **Use a dedicated account** with only the View and Download roles. Never the
  admin login.
- Treat every environment variable this server reads as a secret.
- The MCP client, and therefore the model driving it, sees every tool result.
  Do not point this server at a library whose metadata you would not put into a
  model's context.

## Read-only by construction

There is no read-only *mode* — there is nothing else. The server registers six
tools, all GET requests. It keeps no state and writes no files.

Every one declares all four MCP annotations — `readOnlyHint: true`,
`destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false` — rather
than leaving three of them to the defaults. That is not a formality: the
specification gives `destructiveHint` and `openWorldHint` a default of **true**,
so a tool that says only `readOnlyHint: true` is silent about two claims and
inherits the stronger one for both.

There is no approval dialog and no `ELICITATION` variable here, because there is
nothing to ask about: no tool of this server changes anything. The other servers
in this family have one — see, for instance,
[imap-mcp's](https://imap-mcp.ni-c.de/guide/approval) — and a variable that did
nothing would be worse than none at all.

## Transport

- **Redirects are refused** (`redirect: 'error'`). Basic credentials are resent
  by default on redirects; refusing them means the header can never be replayed
  to a host you did not configure.
- Every request carries a 30-second timeout that also covers body streaming.
- Insecure TLS, when enabled, is scoped to the configured origin — see
  [Configuration](/guide/configuration).

## The XML pipeline

OPDS is Atom XML, and XML parsers have a long history of being the hole. This
one is deliberately dumb:

- Documents declaring a `DOCTYPE` or `ENTITY` are **refused before parsing** — a
  legitimate Calibre-Web feed never contains one, and this closes entity
  expansion for good, independent of parser defaults.
- Entity processing in the parser is off; the five XML built-ins and numeric
  references are decoded by this server's own code, which refuses control
  characters (C0 and C1) and looks entities up in a null-prototype map, so
  `&constructor;` resolves to nothing instead of `Object.prototype`.
- Value coercion is off — a book titled "1984" stays a string.
- Deeply nested and oversized documents are rejected (the parser enforces a
  nesting cap; an 8 MB streaming cap sits in front of it).

## Untrusted metadata

Book titles, authors, tags, series and summaries were written by publishers,
scrapers, or whoever filled the library. Every result that carries them:

- includes an explicit note that this is untrusted data, not instructions,
- has control characters and BiDi override characters stripped (the
  Trojan-Source primitive),
- and only contains URLs that resolve to the **configured origin** over
  http(s) — a hostile feed cannot plant `javascript:`, `file:` or cross-origin
  links into the model context as legitimate-looking library URLs.

Covers are only passed through for real raster image types (JPEG, PNG, GIF,
WebP); SVG — active content — and anything mislabelled is refused.

## Reporting

Please use
[GitHub private vulnerability reporting](https://github.com/ni-c/calibreweb-mcp/security/advisories/new) —
see [SECURITY.md](https://github.com/ni-c/calibreweb-mcp/blob/main/SECURITY.md).
