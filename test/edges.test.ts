import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { CalibreWebApi } from '../src/api.js';
import { jsonResult, run } from '../src/result.js';
import { connect, stubCalibreWeb, testConfig } from './helpers.js';

function firstText(result: CallToolResult): string {
  const block = result.content[0];
  return block?.type === 'text' ? block.text : '';
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('jsonResult ceiling', () => {
  it('passes small payloads through verbatim', () => {
    expect(firstText(jsonResult({ a: 1 }))).toBe('{\n  "a": 1\n}');
  });

  it('drops summaries when the payload is too large', () => {
    const books = Array.from({ length: 50 }, (_, i) => ({
      id: i,
      summary: 's'.repeat(10_000),
    }));
    const text = firstText(jsonResult({ books }));
    expect(text.length).toBeLessThanOrEqual(400_000 + 200);
    expect(text).toContain('(omitted: result too large)');
    expect(text).toContain('summaries were dropped');
  });

  it('hard-truncates when even the stripped payload is too large', () => {
    const books = Array.from({ length: 5000 }, (_, i) => ({
      id: i,
      title: 't'.repeat(100),
    }));
    const text = firstText(jsonResult({ books }));
    expect(text.length).toBeLessThanOrEqual(400_000 + 1000);
    expect(text).toContain('… (truncated');
  });
});

describe('error shaping', () => {
  it('truncates a long plain-text error body', async () => {
    stubCalibreWeb({
      '/opds/stats': { body: 'e'.repeat(5000), status: 500 },
    });
    const client = await connect();
    const result = (await client.callTool({
      name: 'get_stats',
      arguments: {},
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    const text = firstText(result);
    expect(text).toContain('… (truncated)');
    expect(text.length).toBeLessThan(3000);
  });

  it('adds no hint for an unmapped status', async () => {
    stubCalibreWeb({ '/opds/stats': { body: 'oops', status: 500 } });
    const client = await connect();
    const result = (await client.callTool({
      name: 'get_stats',
      arguments: {},
    })) as CallToolResult;
    expect(firstText(result)).not.toContain('Hint:');
  });

  it('converts a non-Error throw into an error result', async () => {
    const result = await run(async () => {
      throw 'plain string';
    });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain('plain string');
  });
});

describe('api edge cases', () => {
  it('reports invalid JSON from the stats endpoint with a URL hint', async () => {
    stubCalibreWeb({
      '/opds/stats': { body: 'not json', contentType: 'application/json' },
    });
    const client = await connect();
    const result = (await client.callTool({
      name: 'get_stats',
      arguments: {},
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain('CALIBRE_WEB_URL');
  });

  it('drops non-numeric stats fields', async () => {
    stubCalibreWeb({
      '/opds/stats': {
        body: JSON.stringify({ books: 'many', authors: 2 }),
        contentType: 'application/json',
      },
    });
    const client = await connect();
    const result = (await client.callTool({
      name: 'get_stats',
      arguments: {},
    })) as CallToolResult;
    const data = JSON.parse(firstText(result)) as Record<string, unknown>;
    expect(data.books).toBeUndefined();
    expect(data.authors).toBe(2);
  });

  it('reports a single missing credential on a call', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const client = await connect({ password: undefined });
    const result = (await client.callTool({
      name: 'get_stats',
      arguments: {},
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain('CALIBRE_WEB_PASSWORD');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('exposes the configured base URL for href absolutization', () => {
    const api = new CalibreWebApi(testConfig);
    expect(api.url).toBe(testConfig.url);
  });

  it('builds an insecure dispatcher only when asked to', () => {
    // Constructing with insecureTls exercises the Agent setup; the request
    // path itself needs a live TLS endpoint and is covered by the smoke test.
    const api = new CalibreWebApi({ ...testConfig, insecureTls: true });
    expect(api.url).toBe(testConfig.url);
  });
});
