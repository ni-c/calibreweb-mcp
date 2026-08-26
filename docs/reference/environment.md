# Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `CALIBRE_WEB_URL` | yes | Root URL of the Calibre-Web instance, e.g. `https://books.example.com`. The `/opds` path is appended automatically. Subpath installations (`https://host.example/calibre`) work. |
| `CALIBRE_WEB_USERNAME` | yes¹ | Username of the Calibre-Web account. The OPDS feed authenticates with the normal web login via HTTP Basic auth. |
| `CALIBRE_WEB_PASSWORD` | yes¹ | Password of that account (the web login password — Calibre-Web has no separate API tokens). |
| `CALIBRE_WEB_INSECURE_TLS` | no | `true` to accept self-signed certificates. Scoped to the configured host; never disables TLS validation process-wide. |

¹ The credentials count as a pair: leave **both** unset for an instance that
allows anonymous browsing; setting only one of them is a configuration error.

## Behaviour without configuration

The server starts and lists its tools even with nothing set — registries and
sandbox inspectors can introspect it. Every tool call then fails with setup
instructions instead of reaching any host.

## Validation at startup

- Fatal: an unparseable URL, a non-http(s) scheme, or credentials embedded in
  the URL (`https://user:pass@host` — they would end up in logs; use the
  dedicated variables).
- Warning: plain `http://` to a non-loopback host (the password would cross the
  network unencrypted), or only one of the two credential variables set.
- `CALIBRE_WEB_PASSWORD` is deleted from `process.env` immediately after being
  read.

## Narrowing the tool list

| Variable | Required | Description |
| --- | --- | --- |
| `CALIBRE_WEB_ALLOW_TOOLS` | no | Tool names, `list_*` prefixes or `essential`; only these register |
| `CALIBRE_WEB_DENY_TOOLS` | no | Same syntax; subtracted from whatever the allow list left |

Both are comma-separated. Each entry is either an exact tool name or a prefix with
a single trailing `*`. Entries are trimmed and matched case-insensitively; empty
entries are ignored, and a value that is empty or only whitespace counts as unset —
`CALIBRE_WEB_ALLOW_TOOLS=` in a compose file does not mean "allow nothing".
`essential` is recognised only in the allow list, and selects `search_books`, `list_books`, `list_shelves`, `get_shelf_books`, `get_stats`.

**An entry that matches no tool aborts startup**, naming the entry and listing the
valid names, as does a malformed pattern such as `*_x` or `list_*_x`. The
alternative — ignoring the entry — leaves a tool missing from `tools/list` with
nothing pointing at the cause. If both lists together remove everything, the server
refuses to start rather than offering an empty tool list.
