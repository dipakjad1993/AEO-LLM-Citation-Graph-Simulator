FROM node:20-slim AS base
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
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
