# Deploy root MUST be companion/ (Railway Root Directory = companion).
# Build context is this folder only — repo-level shared/ is not available in the image.
# Do not import ../../shared — with WORKDIR=/app that resolves to /shared and crashes boot.
FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# Fail the image build if critical modules cannot resolve inside companion/.
RUN npm run check:boot

ENV NODE_ENV=production
EXPOSE 8788

CMD ["node", "src/server.js"]
