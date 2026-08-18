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
  insecureTls: boolean;
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
    return { url: undefined, username, password, insecureTls };
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
    // Redacted, and deliberately so: the userinfo check below only runs once the
    // URL parses, so a value that does not parse at all but still carries
    // credentials — "https://admin:s3cret@host:99999", an out-of-range port —
    // would otherwise print the password into the MCP client's log file.
    console.error(
      `calibreweb-mcp: CALIBRE_WEB_URL is not a valid URL: ${redactUrlCredentials(url)}`
    );
    process.exit(1);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    console.error(
      `calibreweb-mcp: CALIBRE_WEB_URL must use http:// or https:// (got ${parsed.protocol})`
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

  return {
    url: url.replace(/\/+$/, ''),
    username,
    password,
    insecureTls,
  };
}

function isLoopbackHost(hostname: string): boolean {
  // URL.hostname keeps the brackets around an IPv6 literal, so comparing against
  // a bare '::1' never matches and the plain-http warning fires on a loopback
  // URL written as http://[::1]:8083.
  const host = hostname.replace(/^\[|\]$/g, '');
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.startsWith('127.') ||
    host === '::1'
  );
}
