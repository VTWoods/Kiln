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

Run the Django backend and Vite dev server in separate terminals — Vite proxies `/api` requests to Django:

```bash
# Terminal 1
PORT=8091 make dev-api

# Terminal 2
API_PORT=8091 make dev-web
```

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
