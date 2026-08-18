/**
 * Matches the userinfo part of a URL (`scheme://user:pass@`).
 *
 * Applied as a string rewrite rather than via `new URL`, for two reasons: a value
 * that is already percent- or XML-encoded is handed back byte-identical when it
 * holds no credentials, and a value that is *not* a valid URL — the case
 * `loadConfig` reports on — still gets redacted.
 */
const URL_USERINFO = /^([a-z][a-z0-9+.-]*:\/\/)[^/?#@]*@/i;

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
