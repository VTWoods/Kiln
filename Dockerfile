# Stage 1: Build the React + Vite frontend
FROM node:22-alpine AS web-builder
WORKDIR /src/web

COPY web/package.json web/package-lock.json ./
RUN npm ci

COPY web/ ./
RUN npm run build

# Stage 2: Build the static Go server binary (pure-Go SQLite, CGO disabled)
FROM golang:1.24-bookworm AS go-builder
WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY cmd/ ./cmd/
COPY internal/ ./internal/
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/kiln ./cmd/server

# Stage 3: Minimal runtime with Python + recipe-scrapers
FROM python:3.12-slim-bookworm AS runtime
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY scripts/requirements.txt ./scripts/requirements.txt
RUN pip install --no-cache-dir -r ./scripts/requirements.txt

COPY --from=go-builder /out/kiln /app/kiln
COPY --from=web-builder /src/web/dist /app/web/dist
COPY scripts/scrape_recipe.py /app/scripts/scrape_recipe.py

RUN useradd --create-home --shell /usr/sbin/nologin kiln \
    && mkdir -p /data/images \
    && chown -R kiln:kiln /app /data

USER kiln

ENV HOST=0.0.0.0 \
    PORT=8080 \
    DB_PATH=/data/kiln.db \
    IMAGES_DIR=/data/images \
    STATIC_DIR=/app/web/dist \
    SCRAPER_PYTHON=python3 \
    SCRAPER_SCRIPT=/app/scripts/scrape_recipe.py \
    GIN_MODE=release

EXPOSE 8080
VOLUME ["/data"]

ENTRYPOINT ["/app/kiln"]
