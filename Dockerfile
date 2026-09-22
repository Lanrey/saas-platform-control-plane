# ============================================================
# Multi-stage Dockerfile for Platform Management API
# Stage 1: Build    — compiles TypeScript, installs all deps
# Stage 2: Production — lean runtime image, no dev dependencies
# ============================================================

# --- Stage 1: Build ---
FROM node:20-alpine AS builder

WORKDIR /app

# Copy manifests first for better layer caching
COPY package*.json tsconfig*.json nest-cli.json ./

# Install ALL dependencies (including devDeps for build)
RUN npm ci

# Copy source code
COPY src ./src

# Compile TypeScript
RUN npm run build

# Prune dev dependencies from node_modules
RUN npm prune --omit=dev

# --- Stage 2: Production ---
FROM node:20-alpine AS production

# Principle of least privilege: run as non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Copy compiled output and production node_modules
COPY --from=builder --chown=appuser:appgroup /app/dist ./dist
COPY --from=builder --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /app/package.json ./package.json

# Switch to non-root user
USER appuser

# Expose application port
EXPOSE 3000

# Health check — liveness probe
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

# Start the compiled application
CMD ["node", "dist/main"]
