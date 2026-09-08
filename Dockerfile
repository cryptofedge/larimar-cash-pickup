# Larimar — production image
#
# Multi-stage: dependencies, build, then a minimal runtime that carries no build
# toolchain. The runtime stage runs as a non-root user, which is a baseline
# requirement for anything handling financial data.
#
# NOTE: this produces a runnable DEMO image. It is not a production deployment —
# see docs/DEPLOYMENT.md for what else is required (managed secrets, TLS
# termination, network policy, image scanning, and an actual licence to operate).

# ---------------------------------------------------------------- dependencies
FROM node:22-alpine AS deps
WORKDIR /app

# Prisma needs OpenSSL for its query engine.
RUN apk add --no-cache libc6-compat openssl

COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --ignore-scripts && npx prisma generate

# ----------------------------------------------------------------------- build
FROM node:22-alpine AS builder
WORKDIR /app

RUN apk add --no-cache libc6-compat openssl

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build-time placeholders. Real secrets are injected at runtime, never baked in.
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build?schema=public"
ENV SESSION_SECRET="build-time-placeholder-not-a-real-secret-000"
ENV ENCRYPTION_KEY="YnVpbGQtdGltZS1wbGFjZWhvbGRlci0zMi1ieXRlcyEh"
ENV PICKUP_CODE_PEPPER="build-time-placeholder-not-a-real-secret-000"
ENV PAYMENT_WEBHOOK_SECRET="build-time-placeholder-not-a-real-secret-000"
ENV KYC_WEBHOOK_SECRET="build-time-placeholder-not-a-real-secret-000"

RUN npx prisma generate && npm run build

# --------------------------------------------------------------------- runtime
FROM node:22-alpine AS runner
WORKDIR /app

RUN apk add --no-cache libc6-compat openssl

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

# Never run a payments application as root.
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/prisma ./prisma

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "run", "start"]
