# Getting started

## Requirements

- Node.js 22 or newer (or Docker)
- A running Calibre-Web or Calibre-Web Automated instance

## 1. Create a dedicated user

The OPDS feed authenticates with the normal web login, so the credentials you
give this server are a full Calibre-Web account. Do not hand it your admin
login — create a user that can only look at things:

1. **Admin → Users → Add new user**
2. Grant only **View** and **Download** (Download is what puts the per-format
   download links into the feed)
3. Leave Admin, Edit, Upload and Delete unchecked

If your instance allows **anonymous browsing**, you can skip this and leave both
credential variables unset.

## 2. Run the server

```sh
export CALIBRE_WEB_URL=https://books.example.com
export CALIBRE_WEB_USERNAME=reader
export CALIBRE_WEB_PASSWORD=…

npx -y calibreweb-mcp
```

The server speaks MCP on stdio — it prints one status line to stderr and then
waits for a client. Point your MCP client at it (see
[Connecting clients](/guide/clients)) and try:

- `get_stats` — total books, authors, categories and series
- `search_books` with `query: "tolkien"`
- `list_books` — the most recently added books

## 3. Verify without a client

The MCP Inspector drives any stdio server from the command line:

```sh
npx @modelcontextprotocol/inspector --cli \
  -e CALIBRE_WEB_URL=https://books.example.com \
  -e CALIBRE_WEB_USERNAME=reader \
  -e CALIBRE_WEB_PASSWORD=… \
  npx calibreweb-mcp --method tools/list
```

## Troubleshooting the first call

| Symptom | Cause |
| --- | --- |
| `HTTP 401` | Wrong username/password, or (on a download URL) the user lacks the Download role. |
| `returned an HTML page instead of an Atom feed` | `CALIBRE_WEB_URL` does not point at the instance root, or a proxy answered with a login page. |
| `HTTP 404` on a view | That feed is hidden by the user's sidebar visibility settings (**Admin → Edit User → View**). |
| Tools list but every call fails with setup instructions | The environment variables are not set — the server deliberately starts without them. |

More in the [FAQ](/guide/faq).
