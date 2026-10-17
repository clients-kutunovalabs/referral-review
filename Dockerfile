# syntax=docker/dockerfile:1.7
# Two images from one file:   docker build --target web -t tasks-web .     docker build --target worker -t tasks-worker .
# ui-hub (the design gallery) is never built or copied into either image.
ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo

# Manifests only, so this layer is reused until a dependency changes.
FROM base AS manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY apps/ui-hub/package.json apps/ui-hub/
COPY packages/ai/package.json packages/ai/
COPY packages/auth/package.json packages/auth/
COPY packages/client/package.json packages/client/
COPY packages/config/package.json packages/config/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/money/package.json packages/money/
COPY packages/server/package.json packages/server/
COPY packages/storage/package.json packages/storage/
COPY packages/ui/package.json packages/ui/

FROM manifests AS build-deps
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile --filter "@rr/web..."

FROM build-deps AS build
ENV NEXT_TELEMETRY_DISABLED=1 NODE_ENV=production
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/web apps/web
RUN pnpm --filter @rr/web build

# ---------- web: only the traced, self-contained Next.js output ----------
FROM node:${NODE_VERSION}-bookworm-slim AS web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 UPLOAD_DIR=/data/uploads
RUN useradd --system --uid 10001 --home-dir /app --shell /usr/sbin/nologin app && mkdir -p /data/uploads && chown -R app /data
WORKDIR /app
COPY --from=build --chown=app /repo/apps/web/.next/standalone ./
COPY --from=build --chown=app /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=app /repo/apps/web/public ./apps/web/public
USER app
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]

# ---------- worker: expiry sweeper, housekeeping, reconciliation, and the migrate/seed commands ----------
FROM manifests AS worker-deps
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile --prod --filter "@rr/worker..."

FROM worker-deps AS worker
ENV NODE_ENV=production
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/worker apps/worker
RUN useradd --system --uid 10001 --home-dir /repo --shell /usr/sbin/nologin app && chown -R app /repo
USER app
# `work` runs the jobs until stopped. One-off commands: docker run ... migrate | seed | reconcile | expire | purge
ENTRYPOINT ["pnpm", "--filter", "@rr/worker", "exec", "tsx", "src/cli.ts"]
CMD ["work"]
