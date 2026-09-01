import { assertLoopback, waitForHttp } from 'mcp-integration-harness';

/**
 * Brings the throwaway Calibre-Web from first start to serving OPDS.
 *
 * Calibre-Web has no API for any of this. Its first run redirects everything to
 * `/admin/dbconfig`, which is a browser form behind a login, so the bootstrap
 * does what a browser would: log in, read the CSRF token out of the page, post
 * the library path back. Two forms, and the second one is only reachable once
 * the first has produced a session cookie.
 *
 * The library itself is a **fixture in the repository** rather than something
 * built here. A Calibre library cannot create itself: the schema in
 * `metadata.db` carries triggers that call Calibre's own `title_sort` and
 * `uuid4` SQL functions, so generating one at run time would mean
 * reimplementing them. Three books, about 450 kB, mounted read-only.
 */

export const USERNAME = 'admin';
/** Calibre-Web's own default. It has no way to seed a different one. */
export const PASSWORD = 'admin123';

/** Titles in the fixture library, in the order Calibre-Web lists them. */
export const TITLES = ['Dune', 'The Dispossessed', 'Rendezvous with Rama'];
export const SHELF = 'Integration Shelf';
/** Book ids put on that shelf — the first two of the three in the fixture. */
export const SHELVED = [1, 2];

export interface Sandbox {
  url: string;
  env: Record<string, string>;
}

/** Pulls the CSRF token out of a rendered Calibre-Web form. */
function csrfToken(html: string): string {
  const match = /name="csrf_token"[^>]*value="([^"]+)"/.exec(html);
  if (match?.[1] === undefined) {
    throw new Error(
      `no csrf_token in the page — Calibre-Web renders one into every form, ` +
        `so a page without it is usually a redirect to /login. Got: ` +
        `${html.slice(0, 200)}`
    );
  }
  return match[1];
}

/** Keeps the session cookie across requests, which is all this flow needs. */
class Session {
  private cookie = '';

  constructor(private readonly url: string) {}

  private remember(response: Response): void {
    const set = response.headers.getSetCookie();
    if (set.length > 0) {
      this.cookie = set.map((line) => line.split(';')[0]).join('; ');
    }
  }

  async get(path: string): Promise<string> {
    const response = await fetch(`${this.url}${path}`, {
      headers: this.cookie === '' ? {} : { cookie: this.cookie },
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    });
    this.remember(response);
    return response.text();
  }

  /**
   * A POST with the CSRF token in a **header** rather than a form field.
   *
   * `/shelf/add/{shelf}/{book}` takes no body at all and answers 400 without
   * `X-CSRFToken`, which reads like a bad book id. Two conventions in one
   * application, and only one of them is in a form.
   */
  async postCsrfHeader(path: string, token: string): Promise<number> {
    const response = await fetch(`${this.url}${path}`, {
      method: 'POST',
      headers: {
        'x-csrftoken': token,
        'x-requested-with': 'XMLHttpRequest',
        ...(this.cookie === '' ? {} : { cookie: this.cookie }),
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    });
    this.remember(response);
    return response.status;
  }

  async post(path: string, form: Record<string, string>): Promise<number> {
    const response = await fetch(`${this.url}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        ...(this.cookie === '' ? {} : { cookie: this.cookie }),
      },
      body: new URLSearchParams(form),
      redirect: 'manual',
      signal: AbortSignal.timeout(60_000),
    });
    this.remember(response);
    return response.status;
  }
}

export async function bootstrap(
  url = 'http://127.0.0.1:8083'
): Promise<Sandbox> {
  assertLoopback(url);
  // Calibre-Web answers every path with a redirect until it is configured, so
  // any response at all means the process is up.
  await waitForHttp(url, { timeoutSeconds: 180 });

  const session = new Session(url);

  const login = await session.get('/login');
  const status = await session.post('/login', {
    csrf_token: csrfToken(login),
    username: USERNAME,
    password: PASSWORD,
    submit: '',
    next: '/admin/dbconfig',
    remember_me: 'on',
  });
  if (status !== 302 && status !== 200) {
    throw new Error(`Calibre-Web refused the login: HTTP ${status}`);
  }

  const dbconfig = await session.get('/admin/dbconfig');
  if (!dbconfig.includes('config_calibre_dir')) {
    // Already configured, which on a fresh volume should not happen — and
    // saying which state it is in beats the OPDS feed coming back empty later.
    throw new Error(
      'Calibre-Web did not offer the library form. Either the login did not ' +
        'take, or this instance is already configured — run `docker compose ' +
        '-f test/integration/compose.yml down -v` and up again.'
    );
  }
  const configured = await session.post('/admin/dbconfig', {
    csrf_token: csrfToken(dbconfig),
    // The path the compose file mounts the fixture library at, inside the
    // container. Calibre-Web validates it and refuses one it cannot read.
    config_calibre_dir: '/books',
    submit: '',
  });
  if (configured >= 400) {
    throw new Error(
      `Calibre-Web refused the library path: HTTP ${configured}. Is ` +
        'test/integration/library mounted, and does it contain metadata.db?'
    );
  }

  // The library is loaded asynchronously after the form is accepted, so the
  // OPDS feed is the readiness signal rather than the redirect.
  await waitForHttp(`${url}/opds/new`, {
    timeoutSeconds: 60,
    ready: (response) => response.status !== 500,
  });

  // A shelf with books on it, so `list_shelves` and `get_shelf_books` have
  // something to answer. Shelves are a Calibre-Web concept rather than a
  // Calibre one, so they cannot come from the fixture library.
  const create = await session.get('/shelf/create');
  const token = csrfToken(create);
  const created = await session.post('/shelf/create', {
    csrf_token: token,
    title: SHELF,
    is_public: 'on',
  });
  if (created >= 400) {
    throw new Error(`Calibre-Web refused to create a shelf: HTTP ${created}`);
  }
  for (const bookId of SHELVED) {
    const added = await session.postCsrfHeader(`/shelf/add/1/${bookId}`, token);
    if (added >= 400) {
      throw new Error(
        `Calibre-Web refused to shelve book ${bookId}: HTTP ${added}`
      );
    }
  }

  return {
    url,
    env: {
      CALIBRE_WEB_URL: url,
      CALIBRE_WEB_USERNAME: USERNAME,
      CALIBRE_WEB_PASSWORD: PASSWORD,
    },
  };
}
