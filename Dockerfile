# ── Stage 1: build frontend ──────────────────────────────────────
FROM node:20-alpine AS client-builder
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci --legacy-peer-deps
COPY client/ ./
RUN npm run build

# ── Stage 2: build backend ───────────────────────────────────────
FROM node:20-alpine AS api-builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --legacy-peer-deps
COPY tsconfig.json ./
COPY prisma/ ./prisma/
COPY src/ ./src/
RUN npx prisma@5.14.0 generate
RUN npx tsc --project tsconfig.json

# ── Stage 3: production image ────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev --legacy-peer-deps

COPY --from=api-builder /app/dist ./dist
COPY --from=api-builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=client-builder /app/client/dist ./client/dist
COPY prisma/ ./prisma/

EXPOSE 4000

# Use local prisma binary (pinned v5) — avoids npx downloading Prisma 7
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && node dist/app.js"]
