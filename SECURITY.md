# Security policy

## Reporting a vulnerability

Please use [GitHub private vulnerability reporting](https://github.com/ni-c/calibreweb-mcp/security/advisories/new).
Do not open a public issue for an unpatched vulnerability, and do not include real
credentials, tokens, hostnames or private configuration in a report.

You can expect an initial response within a week. Fixed vulnerabilities are published
as a new release with a note in the CHANGELOG.

## Supported versions

Only the latest release and the current `main` branch receive security fixes.

## Trust model

The configured credentials are the web login of a Calibre-Web user. Compromising
them grants whatever that user may do in the web UI — browse and download the
library, and, depending on the assigned roles, edit metadata, upload books or
administer the instance. This server only ever reads the OPDS feed, but the
credentials themselves are not limited to that: **use a dedicated account with
nothing beyond the View and Download roles.**

Treat every environment variable this server reads as a secret. The MCP client
process, and therefore the model driving it, sees every tool result — do not point
this server at a library whose metadata you would not put in a model's context.

## Read-only by construction, not by setting

Most servers in this family take a `*_READ_ONLY` variable that stops the write
tools being registered. This one has none, and its absence is the point: there
is nothing to switch off. The server speaks OPDS, which is a catalogue feed —
it offers no way to change a library, so no writing tool exists to gate. Every
request it makes is a `GET`.

That is worth saying out loud because the _credentials_ are not read-only. A
Calibre-Web login carries whatever roles the account has, and the server's
restraint is no protection if that account may upload or administer. The
dedicated View-and-Download account above is what makes the two agree.

Redirects are refused rather than followed (`redirect: 'error'`). Calibre-Web
redirects to its own login page when a session expires, and following that with
HTTP Basic attached would resend the credentials to whatever host the upstream
named.

A refused login is not tried again for ten seconds. Calibre-Web logs every
refused OPDS login at warning level and does not rate-limit them — the limiter
call in its `verify_password` is commented out and the OPDS routes carry none —
so a model retrying a tool that is annotated read-only, idempotent and cheap is
what gets an address banned by whatever reads those logs. Inside the window the
refusal is repeated from memory, without a request and marked as such. The
record lives in the process, so a restart forgets it.

## Untrusted content

Book titles, authors, series and descriptions come out of the ebook files and
the metadata sources whoever built the library used. Nobody reviewed them on the
way in, and a description is free text that can say anything — including
something addressed at a model reading it.

Every result that carries library content is marked `untrusted: true` with a
`source` field, and control characters are stripped before the text is handed
on. Treat the content as data to report on, never as instructions.

Metadata is also bounded, per field and per entry, and every value the feed
states as a number is checked before it is believed: an id that is not a safe
integer inside Calibre's own range is reported as no id rather than as a value
the result schema refuses. One entry cannot make a listing unanswerable.

## The XML this server parses

An OPDS feed is XML from a network service, which makes XXE the obvious
question. Two answers, deliberately kept independent:

- The parser does not process entities at all, so there is no expansion to
  exploit.
- A document declaring a `DOCTYPE` or an `ENTITY` is refused before it reaches
  the parser — a legitimate Calibre-Web feed never contains one.

The second guard is redundant today and exists so the first cannot change
quietly under a parser update. Response bodies are bounded before parsing (8 MB
for a feed, 1 MB for a cover, 64 KiB for the statistics endpoint), so a hostile
or broken upstream cannot make the server read until it runs out of memory. The
status of a response is decided before its body is read, and an error body is
read under its own small ceiling that cuts instead of refusing.

Turning the markup of a description into text is a single forward pass with no
regular expression over the whole document, so the work an entry can buy is
linear in its own length. `test/linear-time.test.ts` holds every such function
to a budget at the largest input the code accepts.
