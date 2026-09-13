FROM node:20-slim AS base
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip python3-venv curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY requirements-lite.txt ./
RUN pip3 install --break-system-packages -r requirements-lite.txt
RUN python3 -m spacy download en_core_web_sm || true
COPY . .
EXPOSE 3000
ENV PORT=3000
CMD ["node", "server.js"]
