# Stage 1: Build the React + Vite frontend
FROM node:22-alpine AS web-builder
WORKDIR /src/web

COPY web/package.json web/package-lock.json ./
RUN npm ci

COPY web/ ./
RUN npm run build

# Stage 2: Python + Django runtime (with recipe-scrapers, pychromecast, and gunicorn)
FROM python:3.12-slim-bookworm AS runtime
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && python3 -m nltk.downloader -d /usr/local/share/nltk_data averaged_perceptron_tagger_eng wordnet

COPY manage.py ./
COPY kiln_project/ ./kiln_project/
COPY api/ ./api/
COPY --from=web-builder /src/web/dist /app/web/dist

RUN useradd --create-home --shell /usr/sbin/nologin kiln \
    && mkdir -p /data/images \
    && chown -R kiln:kiln /app /data

USER kiln

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOST=0.0.0.0 \
    PORT=8080 \
    DB_PATH=/data/kiln.db \
    IMAGES_DIR=/data/images \
    STATIC_DIR=/app/web/dist

EXPOSE 8080
VOLUME ["/data"]

ENTRYPOINT ["sh", "-c", "python3 manage.py migrate --fake-initial && exec gunicorn kiln_project.wsgi:application --bind ${HOST}:${PORT} --workers 2 --threads 4"]
