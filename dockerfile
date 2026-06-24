# Maven Jobs backend — multi-stage Alpine production image (NestJS + Prisma 7).
#
# Stage 1 (builder): full deps + build toolchain, compile TS, generate client.
# Stage 2 (runner) : copies the already-built, prod-only node_modules + dist.
#
# Alpine notes (musl libc, not glibc):
#   * Prisma's query engine links OpenSSL  -> `apk add openssl`.
#   * bcrypt is a native addon with no musl prebuilt -> it compiles from source,
#     which needs python3/make/g++ in the BUILDER only. We copy the compiled
#     node_modules into the runner so the final image carries no compilers.

# ----------------------------------------------------------------------------
# Stage 1 — builder
# ----------------------------------------------------------------------------
FROM node:24-alpine AS builder
WORKDIR /app

# openssl: Prisma engine. python3/make/g++: compile native deps (bcrypt).
RUN apk add --no-cache openssl python3 make g++

# Install ALL deps (incl. dev) for the build — cached unless lockfile changes.
COPY package.json package-lock.json ./
RUN npm ci

# Generate the Prisma client before copying the rest (better layer caching).
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npx prisma generate

# Compile the NestJS app -> dist/
COPY . .
RUN npm run build

# Drop dev dependencies in place, then regenerate the client so it survives in
# the pruned tree. `prisma` (CLI) + `dotenv` are prod deps, so they remain.
RUN npm prune --omit=dev && npx prisma generate

# ----------------------------------------------------------------------------
# Stage 2 — runner
# ----------------------------------------------------------------------------
FROM node:24-alpine AS runner
ENV NODE_ENV=production
# Internal port baked into the image (NOT read from .env). main.ts honors $PORT.
# Compose publishes this on host 5000 (ports: '5000:8080').
ENV PORT=8080
WORKDIR /app

# Runtime shared libs: openssl for Prisma, libstdc++ for the compiled bcrypt addon.
RUN apk add --no-cache openssl libstdc++

# Bring over the already-built, prod-only deps (incl. compiled bcrypt + the
# generated Prisma client) — no reinstall, no recompile, no toolchain here.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./
COPY --from=builder /app/package.json ./

# Drop root.
USER node

# Documented for readers / tooling; the app binds 0.0.0.0:$PORT (8080 in compose).
EXPOSE 8080

# Run pending migrations (unless RUN_MIGRATIONS=false), then start the server.
# Inlined (no external entrypoint script to copy/maintain) and calling the local
# prisma binary directly so it never tries to fetch the CLI at runtime.
ENTRYPOINT ["sh", "-c", "if [ \"${RUN_MIGRATIONS:-true}\" = \"true\" ]; then echo 'Applying migrations...'; node_modules/.bin/prisma migrate deploy; fi; exec node dist/main"]
