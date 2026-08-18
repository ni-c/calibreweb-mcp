# Contributing

Thanks for taking the time. Small, focused changes with tests land fastest.

## Development setup

```sh
git clone https://github.com/ni-c/calibreweb-mcp.git && cd calibreweb-mcp
npm install
npm test          # unit tests against a stubbed Calibre-Web OPDS feed, no instance needed
npm run build
```

A minimal dev environment:

```sh
export CALIBRE_WEB_URL=http://127.0.0.1:8083
export CALIBRE_WEB_USERNAME=admin
export CALIBRE_WEB_PASSWORD=admin123
node dist/index.js   # speaks MCP on stdio
```

## Expectations

- **Tests.** Behaviour changes come with a test that fails without the change.
  CI runs the test matrix on Node 22 and 24, npm audit, CodeQL and a Trivy
  container scan.
- **Comments** explain constraints the code cannot show — not what the next line does.
- **Security-sensitive areas** (config parsing, XML parsing, anything that builds a
  request URL): please describe the attack you are defending against, or the one
  your change might open, in the PR text.
- **No new runtime dependencies** without a very good reason; the small tree is a
  feature.
- Run `npm run lint` before pushing — it checks both eslint and prettier, and prettier
  also validates the YAML, JSON and Markdown files.

## Questions and bugs

- Questions and ideas → [Discussions](https://github.com/ni-c/calibreweb-mcp/discussions)
- Reproducible problems → [Issues](https://github.com/ni-c/calibreweb-mcp/issues)
- Vulnerabilities → [private reporting](https://github.com/ni-c/calibreweb-mcp/security/advisories/new),
  never a public issue — see [SECURITY.md](SECURITY.md)
