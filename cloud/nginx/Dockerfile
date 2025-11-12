# syntax=docker/dockerfile:1
# cloud/nginx/Dockerfile

# 1) Build dashboard assets (source: cloud/web)
ARG VITE_API_BASE_URL=/api

FROM node:20-alpine AS builder
ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
WORKDIR /app/web

# Copy the entire web project (node_modules/dist are excluded via .dockerignore)
COPY ./web/ ./

# Use npm ci when lockfile exists, fall back to npm install otherwise
RUN if [ -f package-lock.json ]; then \
      echo "Using npm ci (lockfile found)"; \
      npm ci --no-audit --no-fund; \
    else \
      echo "Using npm install (no lockfile)"; \
      npm install --no-audit --no-fund; \
    fi

# Produce production build
RUN npm run build

# 2) Nginx serves static files + proxies API
FROM nginx:1.25-alpine

# Site configuration
COPY ./nginx/site.conf /etc/nginx/conf.d/default.conf

# Dashboard assets
COPY --from=builder /app/web/dist /usr/share/nginx/html

# /data/uploads is mounted via docker-compose for /static/uploads/
