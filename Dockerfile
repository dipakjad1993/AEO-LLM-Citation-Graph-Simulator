FROM node:22-slim AS base
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_BREAK_SYSTEM_PACKAGES=1
# Containers must bind all interfaces: Render/Fly/Cloud Run inject $PORT and probe 0.0.0.0.
ENV HOST=0.0.0.0
ENV PORT=3000
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip python3-venv curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY requirements-lite.txt ./
RUN pip3 install --break-system-packages -r requirements-lite.txt
# spacy ships in requirements-lite; the sm model is ~12MB and required for triple extraction.
RUN python3 -m spacy download en_core_web_sm
# .dockerignore keeps .env / secrets / node_modules out of the image (never bake .env).
COPY . .
# Drop root: run as the unprivileged node user; ensure writable dirs.
RUN mkdir -p /app/data /app/logs && chown -R node:node /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
