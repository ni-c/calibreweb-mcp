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

export class CalibreWebApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    method: string,
    path: string
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

  /** Fetches an OPDS feed and returns the parsed XML document. */
  async getFeed(
    path: string,
    params?: Record<string, string | number | undefined>
  ): Promise<unknown> {
    const { ok, status, response } = await this.send(
      path,
      'application/atom+xml',
      params
    );
    const bytes = await readBoundedBody(response, path, MAX_FEED_BYTES);
    const text = bytes.toString('utf8');
    if (!ok) {
      throw new CalibreWebApiError(status, text, 'GET', path);
    }
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
    const { ok, status, response } = await this.send(path, 'application/json');
    const bytes = await readBoundedBody(response, path, MAX_FEED_BYTES);
    const text = bytes.toString('utf8');
    if (!ok) {
      throw new CalibreWebApiError(status, text, 'GET', path);
    }
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
    const { ok, status, headers, response } = await this.send(path, 'image/*');
    const data = await readBoundedBody(response, path, MAX_COVER_BYTES);
    if (!ok) {
      throw new CalibreWebApiError(status, data.toString('utf8'), 'GET', path);
    }
    return { data, contentType: headers.get('content-type') ?? '' };
  }

  private isConfiguredOrigin(url: string): boolean {
    try {
      return new URL(url).origin === new URL(this.baseUrl).origin;
    } catch {
      return false;
    }
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
  response: {
    headers: Headers;
    body?: unknown;
    arrayBuffer(): Promise<ArrayBuffer>;
  },
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
