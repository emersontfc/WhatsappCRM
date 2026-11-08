# ================================================================
# AgentX / WhatsCRM SaaS - Production Dockerfile
# Optimized for Debian Bookworm Slim with native FFmpeg & Baileys
# ================================================================

FROM node:22-bookworm-slim AS base

# Install system dependencies:
# - ffmpeg: audio conversion to native WhatsApp OGG Opus format
# - curl: healthcheck endpoint probes
# - ca-certificates: secure HTTPS connections to Supabase & Gemini
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Set production environment
ENV NODE_ENV=production
ENV PORT=3000

# Copy package manifests first to leverage Docker layer caching
COPY package*.json ./

# Install all dependencies (including devDependencies required for Vite build and tsx)
RUN npm install --include=dev --ignore-scripts

# Copy the rest of the application code
COPY . .

# Build the frontend assets into dist/
RUN npm run build

# Ensure persistent runtime directories exist with proper permissions
RUN mkdir -p /app/uploads /app/whatsapp_sessions_data

# Persistent storage volumes for sessions and media uploads
VOLUME ["/app/uploads", "/app/whatsapp_sessions_data"]

# Expose HTTP port
EXPOSE 3000

# Container healthcheck against /api/health
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

# Start the unified backend and production static server
CMD ["node", "./node_modules/tsx/dist/cli.mjs", "server.ts"]

