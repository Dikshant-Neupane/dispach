# OpenClaw for the harness benchmark: installed the way its docs say, version pinned.
# The postinstall builds its bundled plugins; npm blocks install scripts unless they are allowed.
FROM node:24-bookworm
RUN npm i -g --allow-scripts=@google/genai,esbuild,koffi,protobufjs,openclaw openclaw@2026.10.5
CMD ["sleep", "infinity"]
