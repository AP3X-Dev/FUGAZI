# syntax=docker/dockerfile:1

ARG BUN_VERSION=1.2.0
ARG NODE_VERSION=22-bookworm-slim

FROM oven/bun:${BUN_VERSION} AS deps
WORKDIR /app

ENV CI=1 \
    LEFTHOOK=0 \
    TURBO_TELEMETRY_DISABLED=1

COPY package.json bun.lock turbo.json tsconfig.json tsconfig.base.json biome.json lefthook.yml ./
COPY packages ./packages
COPY tests/package.json ./tests/package.json

RUN bun install --frozen-lockfile --ignore-scripts

FROM deps AS build
COPY . .
RUN bun run build

FROM node:${NODE_VERSION} AS runtime
WORKDIR /app

ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/LICENSE ./LICENSE

RUN set -eux; \
  printf '%s\n' '#!/usr/bin/env sh' 'exec node /app/packages/cli/bin/fugazi.js "$@"' > /usr/local/bin/fugazi; \
  printf '%s\n' '#!/usr/bin/env sh' 'exec node /app/packages/cli/bin/fugazi-lsp.js "$@"' > /usr/local/bin/fugazi-lsp; \
  printf '%s\n' '#!/usr/bin/env sh' 'exec node /app/packages/cli/bin/fugazi-mcp.js "$@"' > /usr/local/bin/fugazi-mcp; \
  chmod +x /usr/local/bin/fugazi /usr/local/bin/fugazi-lsp /usr/local/bin/fugazi-mcp; \
  mkdir -p /workspace; \
  chown -R node:node /workspace

USER node
WORKDIR /workspace

ENTRYPOINT ["fugazi"]
CMD ["--help"]
