# Kiln

A personal cooking web app for storing recipes and managing shopping lists.

## Stack

- **Backend:** Go + [Gin](https://gin-gonic.com/) + SQLite (`modernc.org/sqlite`, pure Go)
- **Frontend:** React + TypeScript + Tailwind CSS (built with Vite, served as static files by Gin)

## Project Structure

```
.
├── cmd/server/          # Application entry point
├── internal/
│   ├── db/              # SQLite connection and initial schema
│   └── server/          # Gin router, /api/health, and static React SPA serving
├── web/                 # React + TypeScript + Tailwind CSS frontend (Vite)
└── Makefile             # Build, run, and test helpers
```

## Quick Start

Install dependencies:

```bash
make install
```

Build the React frontend and run the Gin server (serves both `/api/*` and the React static bundle on `http://localhost:8080`):

```bash
make run
```

## Development Mode (Hot Reload)

Run the Go backend and Vite dev server in separate terminals — Vite proxies `/api` requests to `http://localhost:8080`:

```bash
# Terminal 1
make dev-api

# Terminal 2
make dev-web
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

## Configuration

| Environment Variable | Default                    | Description                        |
| -------------------- | -------------------------- | ---------------------------------- |
| `HOST`               | `0.0.0.0`                  | HTTP bind address                  |
| `PORT`               | `8080`                     | HTTP listen port                   |
| `DB_PATH`            | `./data/kiln.db`           | SQLite database file path          |
| `IMAGES_DIR`         | `./data/images`            | Cached recipe images directory     |
| `STATIC_DIR`         | `./web/dist`               | Built React static files directory |
| `SCRAPER_PYTHON`     | `./.venv/bin/python3`      | Python interpreter for scraping    |
| `SCRAPER_SCRIPT`     | `./scripts/scrape_recipe.py` | Recipe scraper helper script     |

## Testing

```bash
make test
```
