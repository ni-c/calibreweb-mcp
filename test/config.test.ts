import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadConfig, missingConfigKeys } from '../src/config.js';

function env(vars: Record<string, string>): NodeJS.ProcessEnv {
  return { ...vars };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('loadConfig', () => {
  it('starts without any configuration and only warns', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const config = loadConfig(env({}));
    expect(config.url).toBeUndefined();
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('CALIBRE_WEB_URL')
    );
  });

  it('deletes the password from the environment, even without a URL', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const vars = env({ CALIBRE_WEB_PASSWORD: 'secret' });
    const config = loadConfig(vars);
    expect(vars.CALIBRE_WEB_PASSWORD).toBeUndefined();
    expect(config.password).toBe('secret');
  });

  it('strips trailing slashes from the URL', () => {
    const config = loadConfig(
      env({
        CALIBRE_WEB_URL: 'https://books.example.net//',
        CALIBRE_WEB_USERNAME: 'u',
        CALIBRE_WEB_PASSWORD: 'p',
      })
    );
    expect(config.url).toBe('https://books.example.net');
  });

  it('exits on a URL with embedded credentials', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const exit = vi.spyOn(process, 'exit').mockImplementation((): never => {
      throw new Error('exit');
    });
    expect(() =>
      loadConfig(env({ CALIBRE_WEB_URL: 'https://u:p@books.example.net' }))
    ).toThrow('exit');
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('redacts credentials when reporting an unparseable URL', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation((): never => {
      throw new Error('exit');
    });
    expect(() =>
      loadConfig(env({ CALIBRE_WEB_URL: 'https://admin:s3cret@host:99999' }))
    ).toThrow('exit');
    const output = error.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).not.toContain('s3cret');
    expect(output).toContain('***@');
  });

  it('exits on a non-http(s) scheme', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const exit = vi.spyOn(process, 'exit').mockImplementation((): never => {
      throw new Error('exit');
    });
    expect(() =>
      loadConfig(env({ CALIBRE_WEB_URL: 'ftp://books.example.net' }))
    ).toThrow('exit');
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('warns about plain http to a non-local host', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    loadConfig(
      env({
        CALIBRE_WEB_URL: 'http://books.example.net',
        CALIBRE_WEB_USERNAME: 'u',
        CALIBRE_WEB_PASSWORD: 'p',
      })
    );
    expect(error.mock.calls.join('\n')).toContain('unencrypted');
  });

  it('does not warn about plain http to an IPv6 loopback in brackets', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    loadConfig(
      env({
        CALIBRE_WEB_URL: 'http://[::1]:8083',
        CALIBRE_WEB_USERNAME: 'u',
        CALIBRE_WEB_PASSWORD: 'p',
      })
    );
    expect(error.mock.calls.join('\n')).not.toContain('unencrypted');
  });

  it('warns when only one of username/password is set', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    loadConfig(
      env({
        CALIBRE_WEB_URL: 'https://books.example.net',
        CALIBRE_WEB_USERNAME: 'u',
      })
    );
    expect(error.mock.calls.join('\n')).toContain('must be set together');
  });
});

describe('missingConfigKeys', () => {
  it('accepts the anonymous mode (both credentials unset)', () => {
    expect(
      missingConfigKeys({
        url: 'https://books.example.net',
        username: undefined,
        password: undefined,
        insecureTls: false,
        allowTools: undefined,
        denyTools: undefined,
      })
    ).toEqual([]);
  });

  it('reports a lone username as a missing password', () => {
    expect(
      missingConfigKeys({
        url: 'https://books.example.net',
        username: 'u',
        password: undefined,
        insecureTls: false,
        allowTools: undefined,
        denyTools: undefined,
      })
    ).toEqual(['CALIBRE_WEB_PASSWORD']);
  });

  it('reports a missing URL', () => {
    expect(
      missingConfigKeys({
        url: undefined,
        username: 'u',
        password: 'p',
        insecureTls: false,
        allowTools: undefined,
        denyTools: undefined,
      })
    ).toEqual(['CALIBRE_WEB_URL']);
  });
});
