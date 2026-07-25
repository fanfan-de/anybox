FROM node:22.22.0-alpine AS builder

WORKDIR /workspace
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches patches
COPY packages/mobile-update-server/package.json packages/mobile-update-server/package.json
RUN pnpm install --frozen-lockfile --filter @anybox/mobile-update-server...

COPY packages/mobile-update-server packages/mobile-update-server
RUN pnpm --filter @anybox/mobile-update-server build \
  && pnpm --config.allow-unused-patches=true \
    --filter @anybox/mobile-update-server deploy --prod --legacy /opt/mobile-update-server

FROM node:22.22.0-alpine AS runner

ENV NODE_ENV=production
ENV PORT=3210
WORKDIR /app

COPY --from=builder --chown=node:node /opt/mobile-update-server ./

USER node
EXPOSE 3210
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=12 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3210/livez').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "dist/server.js"]
