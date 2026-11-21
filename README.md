# Kiln

A personal cooking web app for importing recipes from the web, managing shopping lists, and casting step-by-step instructions to a Google Nest Hub.

## Stack

- **Backend:** Python + [Django](https://www.djangoproject.com/) + SQLite + [`recipe-scrapers`](https://github.com/hhursev/recipe-scrapers) + [`pychromecast`](https://github.com/home-assistant-libs/pychromecast)
- **Frontend:** React + TypeScript + Tailwind CSS (built with Vite, served as static files by Django)

## Project Structure

```
.
├── manage.py                # Django CLI entry point
├── requirements.txt         # Python dependencies
├── kiln_project/            # Django settings, URL routing, WSGI config
├── api/
│   ├── models.py            # Recipe, RecipeIngredient, ShoppingList, ShoppingListItem
│   ├── services/            # Safe HTTP fetcher, recipe-scrapers importer, local image cache, Nest Hub caster
│   ├── views/               # JSON API views, Nest Hub Cook Mode view, SPA static fallback
│   └── templates/api/       # Self-contained Nest Hub Cook Mode HTML template
├── web/                     # React + TypeScript + Tailwind CSS frontend (Vite)
├── examples/                # Caddyfile (dev & prod) and Docker Compose deployment examples
├── Dockerfile               # Multi-stage Node + Python/Django container build
└── Makefile                 # Build, run, test, and Docker helpers
```

## Quick Start

Install dependencies:

```bash
make install
```

Build the React frontend, apply SQLite migrations, and run the Django server with Gunicorn (serves both `/api/*` and the React static bundle on `http://0.0.0.0:8080`):

```bash
make run
```

## Development Mode (Hot Reload)

Run Django (`:8091`) and Vite (`:8090`) together in one terminal (configured for HTTPS HMR behind Caddy on port `443`):

```bash
make dev
```

Or run them in separate terminals:

```bash
# Terminal 1
make dev-api

# Terminal 2
make dev-web
```

### Hosting Behind Caddy (HTTPS / PWA Development)

1. **Behind your existing server Caddy (recommended for testing PWA install on your phone):**
   - Copy the dev site block from `examples/Caddyfile.example` into your server's `Caddyfile` (replacing `kiln.example.com` with your domain) and reload Caddy.
   - Start Kiln with `PUBLIC_BASE_URL=https://kiln.example.com make dev`.
   - Caddy routes `/api/*` and `/admin/*` directly to Django (`127.0.0.1:8091`) and everything else (including Vite HMR WebSockets) to Vite (`127.0.0.1:8090`).

2. **Standalone local HTTPS proxy (without touching your system Caddy):**
   - Terminal 1: `HMR_CLIENT_PORT=8443 make dev`
   - Terminal 2: `make dev-caddy` (listens on `https://localhost:8443` with `tls internal`, `admin off`, and `auto_https disable_redirects` so it won't collide with an existing Caddy on `:80`/`:443`/`:2019`).

## Docker

Build the Docker image (`kiln:latest`) and run the container (exposes port `8090` by default and persists SQLite data and cached images in the `kiln-data` volume):

```bash
# Build the image only
make docker-build

# Build and start the container (override port/image/volume as needed)
make docker-run
# e.g. DOCKER_PORT=8080 make docker-run

# Stop and remove the container
make docker-stop
```

Or deploy with Docker Compose using [examples/docker-compose.yml](examples/docker-compose.yml) (paired with Option 2 in [examples/Caddyfile.example](examples/Caddyfile.example) for HTTPS + full offline PWA caching):

```bash
docker compose -f examples/docker-compose.yml up -d --build
```

*(Note: for mDNS Nest Hub discovery inside Docker, pass `--network host`, or enter the Nest Hub IP manually in the Cast modal.)*

## Configuration

| Environment Variable | Default            | Description                                     |
| -------------------- | ------------------ | ----------------------------------------------- |
| `HOST`               | `0.0.0.0`          | HTTP bind address                               |
| `PORT`               | `8080`             | HTTP listen port                                |
| `DB_PATH`            | `./data/kiln.db`   | SQLite database file path                       |
| `IMAGES_DIR`         | `./data/images`    | Cached recipe images directory                  |
| `STATIC_DIR`         | `./web/dist`       | Built React static files directory              |
| `PUBLIC_BASE_URL`    | *(auto-detected)*  | Override URL origin sent to Nest Hub when casting |
| `DJANGO_DEBUG`       | `false`            | Enable Django debug mode (`true` in `dev-api`)  |
| `DJANGO_SECRET_KEY`  | *(dev default)*    | Secret key for Django sessions/admin            |

## Testing

```bash
make test
```
