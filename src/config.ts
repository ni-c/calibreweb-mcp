import { internalHostKind } from 'mcp-internal-hosts';
import { redactUrlCredentials } from './redact.js';

export interface Config {
  /**
   * Base URL of the Calibre-Web instance, e.g. `https://books.example.com` —
   * the root of the web UI; the `/opds` path is appended automatically. May be
   * undefined together with the credentials: the server still starts and lists
   * its tools, every API call then fails with {@link missingConfigMessage}.
   */
  url: string | undefined;
  username: string | undefined;
  /** The normal web-login password of the Calibre-Web user (OPDS uses HTTP Basic auth). */
  password: string | undefined;
  insecureTls: boolean; /**
   * Raw value of `CALIBRE_WEB_ALLOW_TOOLS` — comma-separated tool names, `list_*`
   * prefixes, or `essential`. Kept unparsed on purpose: this file is a mirror of
   * the environment, and the names can only be checked against the tool
   * catalogue, which `buildToolFilter` does.
   */
  allowTools: string | undefined;
  /** Raw value of `CALIBRE_WEB_DENY_TOOLS`, same shape, subtracted from the above. */
  denyTools: string | undefined;
}

/** Shown when the configuration is incomplete — at startup and on every API call. */
export function missingConfigMessage(missing: string[]): string {
  return (
    `missing required environment variable(s): ${missing.join(', ')}\n` +
    'Required: CALIBRE_WEB_URL (e.g. https://books.example.com), ' +
    'CALIBRE_WEB_USERNAME, CALIBRE_WEB_PASSWORD\n' +
    'The credentials are the normal web login of a Calibre-Web user; the OPDS ' +
    'feed authenticates with HTTP Basic auth. If the instance allows anonymous ' +
    'browsing, leave BOTH username and password unset.\n' +
    'Optional: CALIBRE_WEB_INSECURE_TLS=true to accept self-signed certificates'
  );
}

/**
 * Names of the required environment variables that are unset in `config`.
 *
 * Username and password count as a pair: both unset is a supported mode
 * (instances with anonymous browsing serve the OPDS feed without auth), only
 * one of them set is a configuration error.
 */
export function missingConfigKeys(config: Config): string[] {
  const missing: string[] = [];
  if (!config.url) missing.push('CALIBRE_WEB_URL');
  if (!config.username !== !config.password) {
    missing.push(
      !config.username ? 'CALIBRE_WEB_USERNAME' : 'CALIBRE_WEB_PASSWORD'
    );
  }
  return missing;
}

/**
 * Reads the configuration from environment variables.
 *
 * Missing credentials are only a warning, not a fatal error: the server must be
 * able to complete the MCP handshake and answer `tools/list` without them, so
 * registries and sandbox inspectors can introspect it. A malformed URL still
 * exits — that one could send the credentials to the wrong host.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const url = env.CALIBRE_WEB_URL;
  const username = env.CALIBRE_WEB_USERNAME;
  const password = env.CALIBRE_WEB_PASSWORD;
  const insecureTls = env.CALIBRE_WEB_INSECURE_TLS === 'true';
  const allowTools = env.CALIBRE_WEB_ALLOW_TOOLS;
  const denyTools = env.CALIBRE_WEB_DENY_TOOLS;

  // Don't keep the password in process.env for the process lifetime: it would be
  // inherited by child processes and show up in env dumps. (The kernel's
  // /proc/<pid>/environ snapshot is NOT rewritten by this — it always keeps the
  // startup environment.) Deleted before any early return below so no code path
  // leaves it behind.
  delete env.CALIBRE_WEB_PASSWORD;

  if (!url) {
    console.error(
      `calibreweb-mcp: ${missingConfigMessage(['CALIBRE_WEB_URL'])}`
    );
    return {
      url: undefined,
      username,
      password,
      insecureTls,
      allowTools,
      denyTools,
    };
  }
  if (!username !== !password) {
    console.error(
      'calibreweb-mcp: CALIBRE_WEB_USERNAME and CALIBRE_WEB_PASSWORD must be ' +
        'set together (or both left unset for an instance with anonymous browsing)'
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // The value that does not parse at all is the one most likely to be the
    // secret: a password pasted one line too high fails `new URL()`, and
    // redacting userinfo does nothing for a bare one. Quote it only when it
    // looks like a URL at all, and describe the rest by length.
    console.error(
      `calibreweb-mcp: CALIBRE_WEB_URL is not a valid URL: ${describeValue(url)}`
    );
    process.exit(1);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    // Not `(got ${parsed.protocol})`: a 56-character hexadecimal key with a
    // colon after it is a valid URL whose scheme is the key, and that branch
    // would print it in full.
    console.error(
      'calibreweb-mcp: CALIBRE_WEB_URL must use http:// or https://'
    );
    process.exit(1);
  }
  // Credentials embedded in the URL would end up in logs and error messages.
  if (parsed.username || parsed.password) {
    console.error(
      'calibreweb-mcp: CALIBRE_WEB_URL must not contain credentials — use ' +
        'CALIBRE_WEB_USERNAME and CALIBRE_WEB_PASSWORD'
    );
    process.exit(1);
  }
  if (parsed.protocol === 'http:' && !isLoopbackHost(parsed.hostname)) {
    console.error(
      'calibreweb-mcp: WARNING: CALIBRE_WEB_URL uses plain http to a non-local ' +
        'host — the password will be sent unencrypted. Use https:// instead.'
    );
  }

  if (parsed.search !== '' || parsed.hash !== '') {
    console.error(
      'calibreweb-mcp: CALIBRE_WEB_URL carried a query string or fragment; ' +
        'both were dropped — only the origin and path are used.'
    );
  }

  return {
    // The parsed origin and path, not the environment string: a stray space,
    // query or fragment in that string was glued in front of every request
    // path. And the trailing slashes come off with an index walk rather than
    // `replace(/\/+$/, '')`, which is tried from every position of the run and
    // took 1.6 seconds on 80 000 of them.
    url: parsed.origin + trimTrailingSlashes(parsed.pathname),
    username,
    password,
    insecureTls,
    allowTools,
    denyTools,
  };
}

/**
 * Quotes a configuration value only when it has the shape of a URL.
 *
 * `redactUrlCredentials` takes the userinfo out of something that *is* a URL;
 * it cannot help with a value that is a password, an API token or a path. Those
 * are described by length instead, which is all a person debugging their
 * configuration needs.
 */
function describeValue(value: string): string {
  if (!value.includes('://')) {
    return `a ${value.length}-character value that does not look like a URL`;
  }
  const redacted = redactUrlCredentials(value);
  return redacted.length > 120 ? `${redacted.slice(0, 120)}...` : redacted;
}

/** Trailing `/` removed with one walk and one slice. */
function trimTrailingSlashes(path: string): string {
  let end = path.length;
  while (end > 0 && path.charCodeAt(end - 1) === 47) end -= 1;
  return path.slice(0, end);
}

function isLoopbackHost(hostname: string): boolean {
  // The shared classifier, so every spelling of a loopback address is
  // recognised — including http://[::ffff:127.0.0.1] and 'localhost.' with its
  // root label, which the string comparison this replaced did not see.
  return internalHostKind(hostname) === 'loopback';
}
