# The curtain loop job (curtain.mjs): Node and ffmpeg, nothing else.
FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /curtain
# curtain.mjs is mounted by compose.yml, so changing it needs no rebuild.
CMD ["node", "curtain.mjs"]
