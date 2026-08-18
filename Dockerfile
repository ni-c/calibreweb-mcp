# Build stage
# node:24-alpine — active LTS line (Krypton) as of 2026-08-19, resolved to 24-alpine.
FROM node:24-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev --ignore-scripts

# Runtime
FROM node:24-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43
WORKDIR /app
ENV NODE_ENV=production

# npm is not needed at runtime, and removing it keeps the Trivy gate in CI
# strict without an ignore list for npm's vendored dependencies.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# The server reports its version from package.json at runtime.
COPY package.json package-lock.json ./

# Ownership proof for the MCP Registry: must match server.json's name exactly.
LABEL io.modelcontextprotocol.server.name="io.github.ni-c/calibreweb-mcp"

# Drop root: the node image ships an unprivileged `node` user (uid 1000). A
# bind-mounted host directory must be chowned to 1000:1000 on the HOST — the image
# layer's ownership does not apply to it.
USER node

# stdio transport only — no port, no healthcheck. The server starts without
# credentials (tools are listable, so registries and inspectors can introspect it);
# every call then fails with setup instructions instead of reaching the API.
ENTRYPOINT ["node", "dist/index.js"]
