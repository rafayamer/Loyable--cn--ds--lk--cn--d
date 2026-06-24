# ── Stage 1: build frontend ──────────────────────────────────────
FROM node:20-alpine AS client-builder
WORKDIR /app/client
COPY client/package*.json ./
RUN npm install --legacy-peer-deps
COPY client/ ./
RUN npm run build

# ── Stage 2: build backend ───────────────────────────────────────
FROM node:20-alpine AS api-builder
WORKDIR /app
COPY package*.json ./
# Install ALL deps (including prisma CLI) so generate + tsc work
RUN npm install --legacy-peer-deps
COPY tsconfig.json ./
COPY prisma/ ./prisma/
COPY src/ ./src/
# Use local prisma binary — never npx (which downloads latest/v7)
RUN ./node_modules/.bin/prisma generate
RUN ./node_modules/.bin/tsc --project tsconfig.json

# ── Stage 3: production image ────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Prisma needs OpenSSL on Alpine
RUN apk add --no-cache openssl

COPY package*.json ./
# Install prod deps including prisma CLI (moved to dependencies for migrate)
RUN npm install --legacy-peer-deps --omit=dev

COPY --from=api-builder /app/dist ./dist
COPY --from=api-builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=client-builder /app/client/dist ./client/dist
COPY prisma/ ./prisma/

EXPOSE 4000

# Use local prisma v5 binary for migrations, then start app
CMD ["node", "dist/app.js"]
