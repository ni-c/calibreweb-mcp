import { afterEach, describe, expect, it, vi } from 'vitest';

import { testConfig } from './helpers.js';

/**
 * The one code path that weakens TLS, which had no test but a constructor call.
 *
 * `vi.mock` is hoisted, so the fake has to come from `vi.hoisted` — a factory
 * cannot see a `const` declared above it.
 */
const mocks = vi.hoisted(() => ({
  undiciFetch: vi.fn(),
  agentOptions: vi.fn(),
}));

vi.mock('undici', async () => {
  const actual = await vi.importActual<typeof import('undici')>('undici');
  return {
    ...actual,
    Agent: function FakeAgent(this: unknown, options: unknown) {
      mocks.agentOptions(options);
    },
    fetch: mocks.undiciFetch,
  };
});

const { CalibreWebApi } = await import('../src/api.js');

function feedResponse(): Response {
  return new Response('<feed xmlns="http://www.w3.org/2005/Atom"></feed>', {
    status: 200,
    headers: { 'content-type': 'application/atom+xml' },
  });
}

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('the insecure-TLS switch', () => {
  it('does not touch undici when it is off', async () => {
    const globalFetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(feedResponse());
    const api = new CalibreWebApi({ ...testConfig, insecureTls: false });

    await api.getFeed('/opds/new');

    expect(globalFetch).toHaveBeenCalledTimes(1);
    expect(mocks.undiciFetch).not.toHaveBeenCalled();
    expect(mocks.agentOptions).not.toHaveBeenCalled();
  });

  it('builds the relaxed dispatcher only when it is on', () => {
    const api = new CalibreWebApi({ ...testConfig, insecureTls: true });
    expect(api.url).toBe(testConfig.url);
    expect(mocks.agentOptions).toHaveBeenCalledWith({
      connect: { rejectUnauthorized: false },
    });
  });

  it('sends through undici with the dispatcher when it is on', async () => {
    const globalFetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(feedResponse());
    mocks.undiciFetch.mockResolvedValue(feedResponse());
    const api = new CalibreWebApi({ ...testConfig, insecureTls: true });

    await api.getFeed('/opds/new');

    expect(globalFetch).not.toHaveBeenCalled();
    expect(mocks.undiciFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mocks.undiciFetch.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(url).toBe(`${testConfig.url}/opds/new`);
    // The relaxed dispatcher goes only to the configured instance, and the
    // rest of the hardening still applies on that path.
    expect(init.dispatcher).toBeDefined();
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeDefined();
  });

  it('still refuses to follow a redirect on the relaxed path', async () => {
    mocks.undiciFetch.mockResolvedValue(feedResponse());
    const api = new CalibreWebApi({ ...testConfig, insecureTls: true });
    await api.getFeed('/opds/new');
    const [, init] = mocks.undiciFetch.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(init.redirect).toBe('error');
  });
});
