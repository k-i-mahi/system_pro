# syntax=docker/dockerfile:1.7
# Multi-stage build for cognitive-copilot frontend (Vite → static → nginx).

########## 1. deps ##########
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --include=dev

########## 2. build ##########
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# VITE_* vars can be injected at build time.
ARG VITE_API_BASE_URL=/api
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
RUN npm run build

########## 3. runtime (nginx) ##########
FROM nginx:1.27-alpine AS runtime
RUN apk add --no-cache curl \
 && rm /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/app.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=3s --retries=5 \
  CMD curl -fsS http://localhost/ || exit 1
CMD ["nginx", "-g", "daemon off;"]
