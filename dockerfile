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

# ----------------------------------------------------------------------------
# Stage 2 — runner
# ----------------------------------------------------------------------------
FROM node:24-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app

# Runtime libs: openssl (Prisma), libstdc++ (compiled bcrypt addon),
# tini (PID 1 init — reaps zombies + forwards SIGTERM/SIGINT for clean shutdown).
RUN apk add --no-cache openssl libstdc++ tini

# Bring over the already-built, prod-only deps (incl. compiled bcrypt + the
# generated Prisma client) — no reinstall, no recompile, no toolchain here.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./
COPY --from=builder /app/package.json ./

# Drop root.
USER node

# tini is PID 1 and forwards signals to the app for graceful shutdown. The script:
#   - skips all DB work if RUN_MIGRATIONS is not "true"
#   - else runs `migrate status` (read-only) and only calls `migrate deploy` when
#     migrations are actually pending — no apply when the schema is already current
#   - exec's node so it inherits PID and receives SIGTERM directly
ENTRYPOINT ["/sbin/tini", "--", "sh", "-c", "set -e; if [ \"${RUN_MIGRATIONS:-true}\" = \"true\" ]; then echo '[entrypoint] Checking for pending migrations...'; if node_modules/.bin/prisma migrate status >/dev/null 2>&1; then echo '[entrypoint] Schema already up to date — skipping deploy.'; else echo '[entrypoint] Pending migrations — applying...'; node_modules/.bin/prisma migrate deploy; fi; else echo '[entrypoint] RUN_MIGRATIONS disabled — skipping migrations.'; fi; exec node dist/main"]
