FROM node:20-bookworm-slim AS build

WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:20-bookworm-slim

# ffmpeg + streamlink + yt-dlp are needed by Phase 3 (stream pulling + audio decode).
# Installed in Phase 1 image so Phase 3 doesn't require a Docker rebuild.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg python3 python3-pip ca-certificates curl \
    && pip3 install --break-system-packages streamlink yt-dlp \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001

# Railway sends SIGTERM on shutdown; allow up to 30s for in-flight workers to drain.
STOPSIGNAL SIGTERM

CMD ["node", "dist/index.js"]
