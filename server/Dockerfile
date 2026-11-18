# API server: applies pending migrations on start, then runs Express on port 3001
FROM node:22-bookworm-slim

# Prisma's query engine needs OpenSSL
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npx prisma generate

COPY . .

# Uploaded product images live in a volume mounted here; the app runs as the unprivileged node user
RUN mkdir -p uploads/products && chown -R node:node uploads
USER node

ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001

CMD ["sh", "-c", "npx prisma migrate deploy && node src/app.js"]
