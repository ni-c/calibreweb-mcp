# Connecting clients

Every recipe below assumes a dedicated Calibre-Web user with only the View and
Download roles — see [Getting started](/guide/getting-started).

## Claude Code

```sh
claude mcp add calibreweb \
  -e CALIBRE_WEB_URL=https://books.example.com \
  -e CALIBRE_WEB_USERNAME=reader \
  -e CALIBRE_WEB_PASSWORD=… \
  -- npx -y calibreweb-mcp
```

## Claude Desktop

`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "calibreweb": {
      "command": "npx",
      "args": ["-y", "calibreweb-mcp"],
      "env": {
        "CALIBRE_WEB_URL": "https://books.example.com",
        "CALIBRE_WEB_USERNAME": "reader",
        "CALIBRE_WEB_PASSWORD": "…"
      }
    }
  }
}
```

## Codex

`~/.codex/config.toml`:

```toml
[mcp_servers.calibreweb]
command = "npx"
args = ["-y", "calibreweb-mcp"]
env = { CALIBRE_WEB_URL = "https://books.example.com", CALIBRE_WEB_USERNAME = "reader", CALIBRE_WEB_PASSWORD = "…" }
```

## Docker

The container image is multi-arch (amd64 + arm64) and ships an SBOM and build
provenance:

```sh
docker run -i --rm \
  -e CALIBRE_WEB_URL=https://books.example.com \
  -e CALIBRE_WEB_USERNAME=reader \
  -e CALIBRE_WEB_PASSWORD=… \
  ghcr.io/ni-c/calibreweb-mcp
```

As a Claude Desktop entry, use `docker` as the command with
`["run", "-i", "--rm", "-e", "CALIBRE_WEB_URL", …, "ghcr.io/ni-c/calibreweb-mcp"]`
and put the values in `env`.

## MCP Inspector

```sh
npx @modelcontextprotocol/inspector \
  -e CALIBRE_WEB_URL=https://books.example.com \
  -e CALIBRE_WEB_USERNAME=reader \
  -e CALIBRE_WEB_PASSWORD=… \
  npx calibreweb-mcp
```

The server also starts with **no configuration at all** — tools are listable so
registries and sandboxes can introspect it; every call then fails with setup
instructions instead of reaching any host.

## Through mcp-hub

[mcp-hub](https://mcp-hub.ni-c.de) serves many stdio MCP servers from one container
behind a single HTTPS endpoint, so calibreweb-mcp can be reached from clients that cannot
spawn a local process — ChatGPT connectors, Claude on the web, Cursor — without a
container, a hostname and an OAuth stack of its own.

Its `/config/mcp.json` uses Claude Code's format, so the entry is the one you
already have, with the hub's own filter alongside:

```json
{
  "mcpServers": {
    "calibreweb": {
      "command": "npx",
      "args": ["-y", "calibreweb-mcp"],
      "env": { "CALIBRE_WEB_ALLOW_TOOLS": "essential" },
      "denyTools": ["get_cover"]
    }
  }
}
```

`allowTools` and `denyTools` are the hub's **own** per-server filter and take exact
tool names or `list_*` prefixes — the same syntax as the two environment variables,
so a list moves between them verbatim. What does **not** move is `essential`: that
preset is a calibreweb-mcp feature and belongs in `env` as shown.
`"allowTools": ["essential"]` would be a name the hub cannot resolve.

The two compose, and it is worth knowing which does what: the server registers what
its environment variables allow, and the hub exposes what its arrays allow.
Filtering in the server is the tighter of the two — the tool is never built.

Register `https://your-host/calibreweb/mcp` as a connector and you
get this server alone. Register the hub's `/hub` endpoint instead and you reach
_every_ server behind it through six meta-tools, which is the answer worth having
once you run several of these at once.
