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
