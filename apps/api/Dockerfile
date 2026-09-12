# The control plane, and the web app it serves.
#
# One image, one origin: no CORS, no second deployment, and a browser that only
# ever talks to this. The memory engine sits behind it on its own port.
#
# Neither stage copies `pnpm-workspace.yaml`. With it present, pnpm treats /repo
# as the workspace root and puts the store there, so `apps/api/node_modules` is
# a tree of symlinks pointing outside anything the runtime image copies —
# which is exactly how this image first shipped without `cookie-parser`.
# PNPM_CONFIG_STRICT_DEP_BUILDS: pnpm 10+ refuses any command while a
# dependency's build script is merely unapproved. Nothing in either image needs
# one — argon2 ships a prebuilt binding and esbuild belongs to vitest, which
# never runs here — so the whole class is turned off rather than approved one
# package at a time.
FROM node:22-slim AS web
ENV PNPM_CONFIG_STRICT_DEP_BUILDS=false
RUN corepack enable
WORKDIR /web
COPY apps/web/package.json ./
RUN pnpm install --no-frozen-lockfile --ignore-scripts
COPY apps/web/ ./
RUN pnpm exec vite build --outDir /web-dist --emptyOutDir

FROM node:22-slim AS api
ENV PNPM_CONFIG_STRICT_DEP_BUILDS=false
RUN corepack enable
WORKDIR /api
COPY apps/api/package.json ./
# No build scripts anywhere: argon2 ships its binding as an optional platform
# package rather than compiling one, and esbuild — vitest's, never used here —
# is the only thing that wants to run one. pnpm 10 refuses the whole install
# over an unapproved script, so the answer is to want none.
RUN pnpm install --no-frozen-lockfile --ignore-scripts
COPY apps/api/ ./
RUN pnpm exec tsc -p tsconfig.build.json \
 && pnpm install --prod --no-frozen-lockfile --ignore-scripts

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=api /api/node_modules ./node_modules
COPY --from=api /api/dist ./dist
COPY --from=api /api/package.json ./package.json
COPY --from=web /web-dist ./web
# The base catalogue every new organisation is seeded with, at the first path
# `baseSkillsDir()` looks in.
COPY packages/skills/general ./skills/general

RUN useradd --system --uid 10002 drymem && chown -R drymem:drymem /app
USER drymem

ENV WEB_DIR=/app/web
ENV BIND=0.0.0.0
ENV PORT=8080
EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
