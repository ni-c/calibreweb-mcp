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

The server is read-only by construction: it registers no writing tools, sends only
GET requests, refuses redirects (so Basic credentials cannot be replayed to another
host), and bounds every response before parsing it. Book metadata is untrusted
input: it is marked as such in every result, control characters are stripped, and
XML documents declaring a DOCTYPE or entities are refused outright.
