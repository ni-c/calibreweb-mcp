import { XMLParser } from 'fast-xml-parser';
import {
  Agent,
  fetch as undiciFetch,
  type RequestInit as UndiciRequestInit,
} from 'undici';

import {
  missingConfigKeys,
  missingConfigMessage,
  type Config,
} from './config.js';

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Ceiling on a single feed response. The OPDS search endpoint is not paginated
 * server-side — a broad query on a huge library returns every match in one
 * document — and the per-tool budgets in `shape.ts` and `result.ts` only trim
 * data that is already resident as a string. 8 MB is far above any legitimate
 * feed page and far below trouble.
 */
const MAX_FEED_BYTES = 8 * 1024 * 1024;

/**
 * Ceiling on a cover image. Calibre-Web serves the full-size cover on the OPDS
 * cover route (the thumbnail aliases are client compat only). The result goes
 * into the client's context as base64 (+33%), so this is deliberately tight —
 * an oversized scan is better retrieved out-of-band via the book's coverUrl.
 */
const MAX_COVER_BYTES = 1 * 1024 * 1024;

/**
 * Ceiling on the JSON of `/opds/stats`, which is four counters.
 *
 * The feed ceiling was doing this job, and eight megabytes for four numbers is
 * not a ceiling — it is the absence of one at the scale that matters.
 */
const MAX_STATS_BYTES = 64 * 1024;

/**
 * Ceiling on an error body, which is read to be quoted and nothing else.
 *
 * Separate from the success ceilings on purpose: this reader cuts instead of
 * refusing, so a reverse proxy answering a 401 with a two-megabyte login page
 * still surfaces as a 401 with a hint about the credentials.
 */
const MAX_ERROR_BODY_BYTES = 64 * 1024;

/**
 * How long a refused login is remembered, in milliseconds.
 *
 * Calibre-Web's `verify_password` writes `OPDS Login failed for user "%s"
 * IP-address: %s` at warning level for every refusal — the line fail2ban
 * filters on — and the rate limiter that would otherwise cap the attempts is
 * commented out in that function, with no limiter on the OPDS routes at all.
 * Every tool here is annotated read-only, idempotent and cheap, which is
 * exactly what a model retries after "check your credentials". One wrong
 * password should not become a banned address.
 */
const AUTH_REFUSAL_MEMORY_MS = 10_000;

export class CalibreWebApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    method: string,
    path: string,
    /** Set when this answer was repeated from memory rather than requested. */
    public readonly note?: string
  ) {
    super(`Calibre-Web ${method} ${path} failed with HTTP ${status}`);
    this.name = 'CalibreWebApiError';
  }
}

/**
 * The parser is deliberately dumb: no entity processing (the five XML built-ins
 * and numeric references are decoded — with a control-character guard — in
 * `shape.ts`), no value coercion (a book titled "1984" must stay a string), and
 * the xhtml `<content>` blob is kept as a raw string for `htmlToText` instead
 * of being exploded into objects.
 */
const feedParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  processEntities: false,
  parseTagValue: false,
  parseAttributeValue: false,
  isArray: (name) =>
    ['entry', 'link', 'author', 'category', 'dcterms:language'].includes(name),
  stopNodes: ['feed.entry.content'],
});

/**
 * Refuses any document that declares a DTD or entities. The parser above does
 * not process entities, so there is no local expansion exposure — this guard
 * exists so that can never silently change with a parser update, and because a
 * legitimate Calibre-Web feed simply never contains a DOCTYPE.
 */
function assertNoDoctype(xml: string, path: string): void {
  if (/<!(doctype|entity)\b/i.test(xml)) {
    throw new Error(
      `Calibre-Web GET ${path} returned XML containing a DOCTYPE or ENTITY ` +
        'declaration, which this server refuses to parse.'
    );
  }
}

/** Minimal client for the Calibre-Web OPDS endpoints, using HTTP Basic auth. */
export class CalibreWebApi {
  private readonly config: Config;
  private readonly baseUrl: string;
  /** Unset when both credentials are absent — anonymous-browsing instances. */
  private readonly authHeader?: string;
  /**
   * Only set when `CALIBRE_WEB_INSECURE_TLS` is enabled. Scopes the relaxed
   * certificate validation to requests against the configured host instead of
   * disabling it process-wide via NODE_TLS_REJECT_UNAUTHORIZED.
   */
  private readonly insecureDispatcher?: Agent;
  /**
   * The last refused login, until {@link AUTH_REFUSAL_MEMORY_MS} has passed.
   *
   * Per process, which is the honest scope: a restart forgets it, and so does
   * a second server instance.
   */
  private authRefusal: { status: number; body: string; at: number } | undefined;

  constructor(config: Config) {
    this.config = config;
    this.baseUrl = config.url ?? '';
    if (config.username && config.password) {
      this.authHeader = `Basic ${Buffer.from(
        `${config.username}:${config.password}`
      ).toString('base64')}`;
    }
    if (config.insecureTls) {
      this.insecureDispatcher = new Agent({
        connect: { rejectUnauthorized: false },
      });
    }
  }

  /** Base URL for absolutizing feed hrefs; empty string when unconfigured. */
  get url(): string {
    return this.baseUrl;
  }

  private async send(
    path: string,
    accept: string,
    params?: Record<string, string | number | undefined>
  ): Promise<{
    status: number;
    ok: boolean;
    headers: Headers;
    response: Response;
  }> {
    // The credentials are only required here, not at startup, so the server can
    // still be started and introspected without them.
    const missing = missingConfigKeys(this.config);
    if (missing.length > 0) {
      throw new Error(missingConfigMessage(missing));
    }

    const refusal = this.authRefusal;
    if (refusal !== undefined) {
      if (Date.now() - refusal.at < AUTH_REFUSAL_MEMORY_MS) {
        throw new CalibreWebApiError(
          refusal.status,
          refusal.body,
          'GET',
          path,
          'Repeated from memory: this login was refused less than ' +
            `${AUTH_REFUSAL_MEMORY_MS / 1000} seconds ago and was not tried again — ` +
            'Calibre-Web logs every refused OPDS login and does not rate-limit ' +
            'them, so a retry loop is what gets an address banned. Next attempt ' +
            `possible at ${new Date(refusal.at + AUTH_REFUSAL_MEMORY_MS).toISOString()}.`
        );
      }
      this.authRefusal = undefined;
    }

    const headers: Record<string, string> = { Accept: accept };
    if (this.authHeader !== undefined) {
      headers.Authorization = this.authHeader;
    }
    const init: RequestInit = {
      method: 'GET',
      headers,
      // Never follow a redirect: it would resend the Basic credentials to
      // whatever host the upstream points at. (Calibre-Web redirects to its
      // HTML login page when Basic auth is refused behind some proxies — that
      // case surfaces as an explicit error here instead.)
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    };

    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value !== undefined) search.set(key, String(value));
    }
    const query = search.size > 0 ? `?${search.toString()}` : '';
    const url = `${this.baseUrl}${path}${query}`;

    // The insecure dispatcher requires undici's own fetch; the default path
    // uses the (stubbable) global fetch. Only requests that actually go to the
    // configured instance may use the relaxed dispatcher.
    const useInsecure =
      this.insecureDispatcher !== undefined && this.isConfiguredOrigin(url);
    const response = useInsecure
      ? ((await undiciFetch(url, {
          ...init,
          dispatcher: this.insecureDispatcher,
        } as UndiciRequestInit)) as unknown as Response)
      : await fetch(url, init);
    return {
      status: response.status,
      ok: response.ok,
      headers: response.headers,
      response,
    };
  }

  /**
   * Decides on the status before a byte of the body is read.
   *
   * The other order — read under the success ceiling, then look at `ok` — made
   * a 401 behind a reverse proxy that answers with a login page report itself
   * as "returned a response larger than 1048576 bytes and was refused": the
   * size instead of the status, no hint about the credentials, and none of the
   * handling that keys on 401 ever running.
   */
  private async expectOk(
    path: string,
    result: { ok: boolean; status: number; response: BodyLike }
  ): Promise<void> {
    if (result.ok) return;
    const body = await readErrorBody(result.response);
    if (result.status === 401) {
      this.authRefusal = { status: 401, body, at: Date.now() };
    }
    throw new CalibreWebApiError(result.status, body, 'GET', path);
  }

  /** Fetches an OPDS feed and returns the parsed XML document. */
  async getFeed(
    path: string,
    params?: Record<string, string | number | undefined>
  ): Promise<unknown> {
    const result = await this.send(path, 'application/atom+xml', params);
    await this.expectOk(path, result);
    const bytes = await readBoundedBody(result.response, path, MAX_FEED_BYTES);
    const text = bytes.toString('utf8');
    const trimmed = text.trimStart();
    if (/^(<!doctype\s+html|<html[\s>])/i.test(trimmed)) {
      throw new Error(
        `Calibre-Web GET ${path} returned an HTML page instead of an Atom feed — ` +
          'CALIBRE_WEB_URL is probably not the root of the Calibre-Web instance, ' +
          'or a proxy in front of it answered with a login page.'
      );
    }
    assertNoDoctype(text, path);
    try {
      return feedParser.parse(text) as unknown;
    } catch {
      throw new Error(
        `Calibre-Web GET ${path} did not return parseable Atom XML — check CALIBRE_WEB_URL.`
      );
    }
  }

  /** Fetches a JSON endpoint (`/opds/stats`). */
  async getJson(path: string): Promise<unknown> {
    const result = await this.send(path, 'application/json');
    await this.expectOk(path, result);
    const bytes = await readBoundedBody(result.response, path, MAX_STATS_BYTES);
    const text = bytes.toString('utf8');
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error(
        `Calibre-Web GET ${path} did not return valid JSON — check CALIBRE_WEB_URL.`
      );
    }
  }

  /** Fetches a binary body (cover images), bounded by {@link MAX_COVER_BYTES}. */
  async getBinary(
    path: string
  ): Promise<{ data: Buffer; contentType: string }> {
    const result = await this.send(path, 'image/*');
    await this.expectOk(path, result);
    const data = await readBoundedBody(result.response, path, MAX_COVER_BYTES);
    return { data, contentType: result.headers.get('content-type') ?? '' };
  }

  private isConfiguredOrigin(url: string): boolean {
    try {
      return new URL(url).origin === new URL(this.baseUrl).origin;
    } catch {
      return false;
    }
  }
}

/** What both readers below need of a response, and no more. */
interface BodyLike {
  headers: Headers;
  body?: unknown;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/**
 * Reads at most {@link MAX_ERROR_BODY_BYTES} of an error body, and never
 * throws.
 *
 * An error body exists to be quoted in the error message. Refusing to read it
 * because it is large would replace a status the caller can act on with a size
 * nobody can, which is the failure this function was written to end.
 */
async function readErrorBody(response: BodyLike): Promise<string> {
  try {
    const body = response.body;
    if (!hasStreamingBody(body)) {
      const buffer = Buffer.from(await response.arrayBuffer());
      return buffer.subarray(0, MAX_ERROR_BODY_BYTES).toString('utf8');
    }
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      chunks.push(value);
      total += value.byteLength;
      if (total >= MAX_ERROR_BODY_BYTES) {
        await reader.cancel();
        break;
      }
    }
    return Buffer.concat(chunks)
      .subarray(0, MAX_ERROR_BODY_BYTES)
      .toString('utf8');
  } catch {
    // A body that cannot be read is not an error worth replacing the status
    // with; the status is the answer.
    return '';
  }
}

/** Minimal shape of a response body we can read incrementally. */
interface StreamingBody {
  getReader(): {
    read(): Promise<{ done: boolean; value?: Uint8Array }>;
    cancel(): Promise<void>;
  };
}

function hasStreamingBody(body: unknown): body is StreamingBody {
  return (
    typeof body === 'object' &&
    body !== null &&
    typeof (body as StreamingBody).getReader === 'function'
  );
}

/**
 * Reads a response body, refusing anything past `maxBytes`.
 *
 * A declared `content-length` is rejected before a single byte is read; a
 * chunked response is aborted as soon as the accumulated size crosses the
 * ceiling. Responses without a streamable body — which is what the test stubs
 * of global `fetch` return — fall back to `arrayBuffer()` and are checked
 * afterwards.
 */
async function readBoundedBody(
  response: BodyLike,
  path: string,
  maxBytes: number
): Promise<Buffer> {
  const tooLarge = (): Error =>
    new Error(
      `Calibre-Web GET ${path} returned a response larger than ` +
        `${maxBytes} bytes and was refused.`
    );

  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge();

  const body = response.body;
  if (!hasStreamingBody(body)) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > maxBytes) throw tooLarge();
    return buffer;
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value === undefined) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
