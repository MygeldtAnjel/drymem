# The control plane, and the web app it serves.
#
# One image, one origin: no CORS, no second deployment, and a browser that only
# ever talks to this. The memory engine sits behind it on its own port.
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /repo

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
RUN pnpm install --no-frozen-lockfile --ignore-scripts

COPY apps/api/ ./apps/api/
COPY apps/web/ ./apps/web/
# Argon2 ships native bindings; the ignore-scripts above skipped them.
RUN pnpm --filter @drymem/api rebuild @node-rs/argon2 || true
RUN pnpm --filter @drymem/web exec vite build --outDir /web-dist --emptyOutDir \
 && pnpm --filter @drymem/api exec tsc -p tsconfig.build.json

FROM node:22-slim AS runtime
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/apps/api/node_modules ./node_modules_api
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/api/package.json ./package.json
COPY --from=build /web-dist ./web

RUN useradd --system --uid 10002 drymem && chown -R drymem:drymem /app
USER drymem

ENV WEB_DIR=/app/web
ENV BIND=0.0.0.0
ENV PORT=8080
EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
