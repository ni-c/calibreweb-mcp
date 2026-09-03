import type { CallToolResult } from '@modelcontextprotocol/server';

import { CalibreWebApiError } from './api.js';

export function textResult(text: string): CallToolResult {
  return { content: [{ type: 'text', text }] };
}

/**
 * Hard ceiling on a single tool result, as a backstop behind the per-tool caps.
 * Measured in UTF-16 code units (string length), not bytes — a CJK-heavy result
 * can be up to ~3x this in bytes, which is still firmly bounded.
 */
const MAX_RESULT_BYTES = 400_000;

/**
 * An answer in both channels at once, with book summaries stripped if the
 * payload is still pathologically large after the per-tool truncation.
 *
 * A Calibre library can hold book descriptions of arbitrary length, and the
 * OPDS search endpoint returns every match in one feed. Everything downstream
 * of this function assumes the budget held; this is what guarantees it.
 *
 * `structuredContent` is the machine-readable half and the reason every tool
 * here declares an `outputSchema`; the text block stays because the SDK does
 * NOT synthesize one for an object-shaped value, and a client that reads only
 * `content` would otherwise get an empty answer. Both carry the same object —
 * which is why the over-budget path rebuilds the *value* rather than editing
 * its serialization.
 */
export function jsonResult(data: Record<string, unknown>): CallToolResult {
  if (JSON.stringify(data).length <= MAX_RESULT_BYTES) {
    return structuredResult(data);
  }

  const stripped = JSON.parse(
    JSON.stringify(data, (key, value: unknown) =>
      key === 'summary' && typeof value === 'string'
        ? '(omitted: result too large)'
        : value
    )
  ) as Record<string, unknown>;
  if (JSON.stringify(stripped).length <= MAX_RESULT_BYTES) {
    return structuredResult({
      ...stripped,
      notes: [
        ...(Array.isArray(stripped.notes) ? stripped.notes : []),
        `The result exceeded ${MAX_RESULT_BYTES} characters, so book summaries were dropped. Narrow the request to get them back.`,
      ],
    });
  }

  // Dropping summaries is not always enough: the bulk can sit in fields the
  // replacer does not touch — a feed of thousands of books is all titles and
  // URLs. This used to answer with the JSON cut at the ceiling, unparseable but
  // visible. That is no longer an option: `structuredContent` has to parse, and
  // the two channels have to carry the same value. So it is an error, which is
  // the honest description of "there is no answer this size".
  throw new ResultTooLargeError(
    `The result exceeds ${MAX_RESULT_BYTES} characters even without book ` +
      'summaries. Narrow the request — use a more specific query, a lower ' +
      'limit, or the offset parameter.'
  );
}

/**
 * {@link jsonResult}, with the untrusted-content marker on the object.
 *
 * The note has always gone out in `notes`, which is in the text block and in
 * the structured half alike. The two fields are what a client reading only
 * `structuredContent` can *check* rather than have to find in a list of
 * sentences — and they are stripped from the payload before they are set, so
 * the guard cannot be switched off by the content it guards against.
 */
export function untrustedResult(data: Record<string, unknown>): CallToolResult {
  const { untrusted: _untrusted, source: _source, ...rest } = data;
  return jsonResult({
    untrusted: true as const,
    source: 'calibre-web' as const,
    ...rest,
  });
}

/** Raised by {@link jsonResult}; `run` turns it into an error result. */
export class ResultTooLargeError extends Error {}

/** A value in both channels, with no budget applied. */
export function structuredResult(
  data: Record<string, unknown>
): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

export function errorResult(text: string): CallToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

const MAX_ERROR_BODY_LENGTH = 2000;

// Same class as shape.ts: C0/C1 controls, DEL, and BiDi override/isolate
// characters — an upstream error body is as untrusted as feed content.
const UNSAFE_CHARS =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

/**
 * Limits what an upstream error body can inject into the model context: HTML
 * error pages (reverse proxies, WAFs, the Calibre-Web login page) are dropped
 * entirely, other bodies are control-character-stripped and truncated.
 */
function sanitizeErrorBody(body: string): string {
  const trimmed = body.replace(UNSAFE_CHARS, '').trim();
  // Anything markup-shaped: a reverse proxy's error page or a WAF block page.
  // The check is deliberately loose — an XML declaration, a leading comment or
  // a doctype followed by a newline are all the same thing here.
  if (/^(<!doctype|<html[\s>]|<\?xml|<!--)/i.test(trimmed)) {
    return '(HTML error page omitted)';
  }
  if (trimmed.length > MAX_ERROR_BODY_LENGTH) {
    return `${trimmed.slice(0, MAX_ERROR_BODY_LENGTH)}… (truncated)`;
  }
  return trimmed;
}

function hintFor(status: number): string {
  switch (status) {
    case 401:
      return (
        '\nHint: check CALIBRE_WEB_USERNAME and CALIBRE_WEB_PASSWORD — the OPDS feed ' +
        'authenticates with the normal web login of a Calibre-Web user. A 401 on a ' +
        'download URL can also mean the user lacks the Download role.'
      );
    case 403:
      return (
        '\nHint: the read/unread book feeds require a non-anonymous user with ' +
        '"Show Read and Unread" enabled in the user settings.'
      );
    case 404:
      return (
        '\nHint: either CALIBRE_WEB_URL does not point at the root of the Calibre-Web ' +
        'instance, or this feed is hidden by the sidebar visibility settings of the ' +
        'configured user (Admin → Edit User → View).'
      );
    default:
      return '';
  }
}

/** Thrown by tools for problems detected before any request goes out. */
export class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolInputError';
  }
}

/**
 * Runs a tool handler and converts thrown errors into MCP error results instead
 * of protocol-level failures.
 */
export async function run(
  fn: () => Promise<CallToolResult>
): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (error) {
    if (
      error instanceof ToolInputError ||
      error instanceof ResultTooLargeError
    ) {
      return errorResult(error.message);
    }
    if (error instanceof CalibreWebApiError) {
      return errorResult(
        `${error.message}\n${sanitizeErrorBody(error.body)}${hintFor(error.status)}`
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    return errorResult(`calibreweb-mcp: ${message}`);
  }
}
