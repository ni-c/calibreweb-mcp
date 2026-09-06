/**
 * Matches the userinfo part of a URL (`scheme://user:pass@`).
 *
 * Applied as a string rewrite rather than via `new URL`, for two reasons: a value
 * that is already percent- or XML-encoded is handed back byte-identical when it
 * holds no credentials, and a value that is *not* a valid URL — the case
 * `loadConfig` reports on — still gets redacted.
 *
 * The class excludes `/?#` but deliberately not `@`, because userinfo ends at
 * the *last* `@` before the path, not the first. A password may legitimately
 * contain one and nothing percent-encodes it on the way in — the audience for
 * this function are the people who paste `https://user:pass@host` into a config
 * file. Stopping at the first `@` published the tail of such a password:
 * `https://alice:p@ssw0rd@host` came back as `https://***@ssw0rd@host`. Not
 * crossing `/` is what keeps `https://host/users/@alice` untouched, since no
 * `@` is reachable from the scheme without passing the path.
 */
const URL_USERINFO = /^([a-z][a-z0-9+.-]*:\/\/)[^/?#]*@/i;

/**
 * Removes credentials from a URL before it reaches the model or a log.
 *
 * The URLs this server emits are built from `CALIBRE_WEB_URL` plus feed hrefs, so
 * they should never carry userinfo — but a misconfigured value or a reverse proxy
 * rewriting `Location`-style hrefs could smuggle one in, and Basic-auth users are
 * exactly the audience that pastes `https://user:pass@host` into config files.
 */
export function redactUrlCredentials(url: string): string {
  return url.replace(URL_USERINFO, '$1***@');
}
