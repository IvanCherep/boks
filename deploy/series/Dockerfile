# The Series recorder's worker (docs/series-recorder.md): Node, ffmpeg and
# cwebp, nothing else. worker.mjs (scripts/series-worker.mts bundled by every
# release) is mounted by compose.yml, so a new release needs no rebuild, only
# a restart.
FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg webp ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /series
CMD ["node", "worker.mjs"]
