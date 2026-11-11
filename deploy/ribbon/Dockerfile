# The ribbon card job (ribbon.mjs): Node, ffmpeg and Skia (@napi-rs/canvas,
# prebuilt), no browser. The job's code is mounted at /app/job by
# compose.ribbon.yml, so changing it needs no rebuild; a changed
# package-lock.json does (deploy/ops/curtain.sh rebuilds when it changes).
FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
CMD ["node", "job/ribbon.mjs"]
