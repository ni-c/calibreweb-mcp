# vhs script for the demo GIF: `vhs docs/demo.tape` writes public/demo.gif
#
# Prerequisites:
#   * vhs installed (https://github.com/charmbracelet/vhs)
#   * the server built (npm run build)
#   * NO Calibre-Web instance needed: the tape records against the bundled
#     fixture library (docs/demo-server.mjs, three public-domain classics served
#     in exactly the XML shape Calibre-Web produces). The MCP server under
#     demonstration runs unmodified; only the library behind it is synthetic —
#     which is what makes this tape reproducible by anyone with node.
#   * run from the repository root, not from docs/
#
# Only read-only tools exist, so nothing here can touch real data.
#
# Traps learned on earlier tapes (freshrss-mcp):
#   1. vhs starts its own shell — exported variables do not arrive. And the MCP
#      Inspector's stdio transport passes only an allowlisted environment to the
#      spawned server, so CALIBRE_WEB_* must be handed over with explicit `-e`
#      flags, which the wrapper function below does.
#   2. `-e` must come AFTER the server command: `--cli -e K=V node dist/index.js`
#      makes the inspector lose the target ("No servers found in config file").
#   3. Inside a Hide block use vhs's own `Sleep`, never the shell's — a shell
#      sleep blocks and the tape ends before any output is recorded.

Output docs/public/demo.gif

Set FontSize 16
Set Width 1200
Set Height 700
Set Padding 20
Set Theme "Catppuccin Mocha"

Hide
Sleep 1s
Type "clear" Enter
Sleep 500ms
Type "node docs/demo-server.mjs 2>/dev/null & disown" Enter
Sleep 500ms
Type 'mcp() { npx -y @modelcontextprotocol/inspector --cli node dist/index.js -e "CALIBRE_WEB_URL=http://127.0.0.1:8099" -e "CALIBRE_WEB_USERNAME=demo" -e "CALIBRE_WEB_PASSWORD=demo" "$@"; }' Enter
Sleep 500ms
Type "clear" Enter
Sleep 500ms
Show

Type "# mcp() = the MCP Inspector CLI against ./dist/index.js, credentials via -e" Enter
Sleep 2s
Type "# 1. what does the server expose?" Enter
Sleep 1s
Type "mcp --method tools/list | jq -r '.tools[].name' | column" Enter
Sleep 8s
Type "# 2. anything about whales in the library?" Enter
Sleep 1500ms
Type "mcp --method tools/call --tool-name search_books --tool-arg query=whale | jq -r '.content[0].text' | head -32" Enter
Sleep 10s
Type "# 3. how big is the library?" Enter
Sleep 1500ms
Type "mcp --method tools/call --tool-name get_stats | jq -r '.content[0].text'" Enter
Sleep 8s
