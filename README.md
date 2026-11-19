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

## Configuration

| Environment Variable | Default           | Description                        |
| -------------------- | ----------------- | ---------------------------------- |
| `PORT`               | `8080`            | HTTP listen port                   |
| `DB_PATH`            | `./data/kiln.db`  | SQLite database file path          |
| `STATIC_DIR`         | `./web/dist`      | Built React static files directory |

## Testing

```bash
make test
```
