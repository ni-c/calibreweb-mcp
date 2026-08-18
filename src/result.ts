import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

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
 * Serializes a result, stripping book summaries if the payload is still
 * pathologically large after the per-tool truncation.
 *
 * A Calibre library can hold book descriptions of arbitrary length, and the
 * OPDS search endpoint returns every match in one feed. Everything downstream
 * of this function assumes the budget held; this is what guarantees it.
 */
export function jsonResult(data: unknown): CallToolResult {
  const text = JSON.stringify(data, null, 2);
  if (text.length <= MAX_RESULT_BYTES) return textResult(text);

  const stripped = JSON.stringify(
    data,
    (key, value: unknown) =>
      key === 'summary' && typeof value === 'string'
        ? '(omitted: result too large)'
        : value,
    2
  );
  const note = `\n\nNote: the result exceeded ${MAX_RESULT_BYTES} characters, so book summaries were dropped. Narrow the request to get them back.`;
  if (stripped.length <= MAX_RESULT_BYTES) return textResult(stripped + note);

  // Dropping summaries is not always enough: the bulk can sit in fields this
  // replacer does not touch — a feed of thousands of books is all titles and
  // URLs. Without this the "hard ceiling" would not be one, so the payload is
  // cut off even though that leaves the JSON unparseable. Truncated JSON the
  // model can see is still better than megabytes of context.
  return textResult(
    `${stripped.slice(0, MAX_RESULT_BYTES)}\n\n… (truncated: the result exceeded ` +
      `${MAX_RESULT_BYTES} characters even without book summaries, so the JSON above ` +
      'is incomplete. Narrow the request — use a more specific query or the offset parameter.)'
  );
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
  if (/^(<!doctype\s|<html[\s>])/i.test(trimmed)) {
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
    if (error instanceof ToolInputError) {
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
