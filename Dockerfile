# ByteSize: one image with the API and the built web app.
# Build for the homelab (linux/amd64 only):  docker buildx build --platform linux/amd64 -t bytesize .

# ---- web app ----
FROM --platform=$BUILDPLATFORM node:22-alpine AS web
WORKDIR /src/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- API (compiled once, on the build machine; the output is plain JavaScript) ----
FROM --platform=$BUILDPLATFORM node:22-alpine AS api
WORKDIR /src/backend
COPY backend/package*.json ./
RUN npm ci
COPY backend/ ./
RUN npm run build

# ---- runtime (linux/amd64) ----
# Debian (glibc), not Alpine: sharp's Alpine build can need newer CPU instructions (AVX2) and crash
# with "illegal instruction" on older homelab CPUs.
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=4100 \
    DATA_DIR=/app/data \
    WEB_DIR=/app/web
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force \
 # In the image the server tools run the compiled files: docker compose exec -u node bytesize npm run reset-password -- <username>
 && npm pkg set scripts.reset-password="node dist/cli/reset-password.js" scripts.auth:reset="node dist/cli/auth-reset.js" scripts.seed-demo="node dist/cli/seed-demo.js"
COPY --from=api /src/backend/dist ./dist
COPY backend/drizzle ./drizzle
COPY --from=web /src/frontend/dist ./web
COPY --chmod=755 backend/docker-entrypoint.sh ./docker-entrypoint.sh
RUN mkdir -p /app/data && chown -R node:node /app/data
# No USER line: the entrypoint starts as root only to fix the data folder's owner, then runs the
# server as node. Server tools run as node too: docker compose exec -u node bytesize npm run reset-password -- <username>
VOLUME ["/app/data"]
EXPOSE 4100
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4100/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
# Database migrations run automatically when the server starts
ENTRYPOINT ["/app/docker-entrypoint.sh"]
