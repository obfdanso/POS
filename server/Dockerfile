# API server: applies pending migrations on start, then runs Express on port 3001

# ── Build: compile the TypeScript sources to dist/ ──────────────────────────────
FROM node:22-bookworm-slim AS builder

# Prisma's query engine needs OpenSSL
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci && npx prisma generate

COPY . .
RUN npm run build

# ── Runtime: production dependencies and the compiled app only ──────────────────
FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npx prisma generate

COPY --from=builder /app/dist ./dist
# Maintenance scripts (backup, restore, unlock-user, ...) run with tsx, a production dependency
COPY scripts ./scripts
# Sample product photos the seed data points at, served under /product-images
COPY product-images ./product-images

# Uploaded product images live in a volume mounted here; the app runs as the unprivileged node user
RUN mkdir -p uploads/products && chown -R node:node uploads
USER node

ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/app.js"]
