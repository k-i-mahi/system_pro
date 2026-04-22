# syntax=docker/dockerfile:1.7
# Multi-stage build for cognitive-copilot backend (Express + Prisma + TypeScript).

########## 1. deps ##########
FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache openssl
COPY package.json package-lock.json* ./
RUN npm ci --include=dev

########## 2. build ##########
FROM node:20-alpine AS build
WORKDIR /app
RUN apk add --no-cache openssl
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Generate Prisma client and compile TypeScript.
RUN npx prisma generate && npm run build

########## 3. prune to prod deps ##########
FROM node:20-alpine AS prunedeps
WORKDIR /app
RUN apk add --no-cache openssl
COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm ci --omit=dev --ignore-scripts \
 && npx prisma generate \
 && npm cache clean --force

########## 4. runtime ##########
FROM node:20-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache openssl curl wget tini \
 && addgroup -S app && adduser -S app -G app
ENV NODE_ENV=production \
    PORT=3001
COPY --from=prunedeps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package.json ./
RUN chown -R app:app /app
USER app
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=6 \
  CMD wget -qO- http://localhost:3001/health || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
