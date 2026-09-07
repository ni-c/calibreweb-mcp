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
- **The status is read before the body.** A response that is not `ok` is
  answered from its status, and its body is read under a separate 64 KiB
  ceiling that cuts rather than refuses — so a 401 behind a proxy that answers
  with a two-megabyte login page still reads as a 401 with a hint about the
  credentials, instead of as "the response was too large".
- **A refused login is remembered for ten seconds.** Calibre-Web logs every
  refused OPDS login at warning level — the line intrusion-detection filters
  key on — and the rate limiter in its `verify_password` is commented out, with
  no limiter on the OPDS routes at all. Every tool here is annotated read-only,
  idempotent and cheap, which is exactly what a model retries after being told
  to check the credentials. Inside the window the refusal is repeated from
  memory, without a request, saying so and naming the time of the next real
  attempt. The record is per process: a restart forgets it.

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
  nesting cap; an 8 MB streaming cap sits in front of it, and `/opds/stats`,
  which is four counters, has its own 64 KiB one).
- Markup is taken out of a description in **one forward pass** rather than by
  re-running a regular expression until the text stops changing. The old shape
  was quadratic — a run of unclosed `<` bought a whole rescan per character —
  and a description is written by whoever filled the library.
- Every number the feed states is bounded before it is believed. An id is read
  as at most ten digits and has to be a safe integer inside Calibre's own
  range; anything else is reported as *no* id rather than as `1e20` or
  `Infinity`, which the result schema would refuse — taking the whole listing
  with it over one entry.

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
WebP), and the type is decided by the **image data**, never by the response
header: an HTML login page served as `image/png`, or an SVG — which is a
document with script in it — matches no signature and is refused. Reading the
data is also the only way to report the type correctly, because Calibre names
every cover file `cover.jpg` whatever the image really is and Calibre-Web
guesses the header from that name.

Sizes are bounded per field as well as per answer. A single metadata field is
cut at 1000 characters and the number of authors, tags, languages and formats
one entry contributes is capped, each with a note in the result — one book with
a megabyte title used to make every listing that paged over it unanswerable.

Every string that leaves is well-formed UTF-16: a character reference naming a
surrogate becomes U+FFFD, and every cut at a length budget is repaired, so a
title ending in an emoji cannot leave half a character in a JSON string.

## Reporting

Please use
[GitHub private vulnerability reporting](https://github.com/ni-c/calibreweb-mcp/security/advisories/new) —
see [SECURITY.md](https://github.com/ni-c/calibreweb-mcp/blob/main/SECURITY.md).
