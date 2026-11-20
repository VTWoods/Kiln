package db

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

const schema = `
CREATE TABLE IF NOT EXISTS recipes (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	title TEXT NOT NULL,
	description TEXT NOT NULL DEFAULT '',
	instructions TEXT NOT NULL DEFAULT '',
	servings INTEGER NOT NULL DEFAULT 1,
	prep_minutes INTEGER NOT NULL DEFAULT 0,
	cook_minutes INTEGER NOT NULL DEFAULT 0,
	source_url TEXT NOT NULL DEFAULT '',
	image_url TEXT NOT NULL DEFAULT '',
	created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS recipe_ingredients (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	recipe_id INTEGER NOT NULL,
	name TEXT NOT NULL,
	quantity TEXT NOT NULL DEFAULT '',
	unit TEXT NOT NULL DEFAULT '',
	sort_order INTEGER NOT NULL DEFAULT 0,
	FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS shopping_lists (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name TEXT NOT NULL,
	created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS shopping_list_items (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	shopping_list_id INTEGER NOT NULL,
	name TEXT NOT NULL,
	quantity TEXT NOT NULL DEFAULT '',
	unit TEXT NOT NULL DEFAULT '',
	checked BOOLEAN NOT NULL DEFAULT 0,
	recipe_id INTEGER,
	FOREIGN KEY (shopping_list_id) REFERENCES shopping_lists(id) ON DELETE CASCADE,
	FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE SET NULL
);
`

// Open initializes a SQLite database at path (or ":memory:") and applies the initial schema.
func Open(path string) (*sql.DB, error) {
	if path != ":memory:" {
		dir := filepath.Dir(path)
		if dir != "" && dir != "." {
			if err := os.MkdirAll(dir, 0o755); err != nil {
				return nil, fmt.Errorf("create database directory %q: %w", dir, err)
			}
		}
	}

	conn, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open sqlite database: %w", err)
	}

	// SQLite performs best with a single writer connection in WAL mode.
	conn.SetMaxOpenConns(1)

	if err := conn.Ping(); err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("ping sqlite database: %w", err)
	}

	pragmas := []string{
		"PRAGMA foreign_keys = ON;",
		"PRAGMA busy_timeout = 5000;",
	}
	if path != ":memory:" {
		pragmas = append(pragmas, "PRAGMA journal_mode = WAL;")
	}

	for _, p := range pragmas {
		if _, err := conn.Exec(p); err != nil {
			_ = conn.Close()
			return nil, fmt.Errorf("execute pragma %q: %w", p, err)
		}
	}

	if _, err := conn.Exec(schema); err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("initialize database schema: %w", err)
	}

	if err := migrate(conn); err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("migrate database schema: %w", err)
	}

	return conn, nil
}

func migrate(conn *sql.DB) error {
	cols, err := tableColumns(conn, "recipes")
	if err != nil {
		return err
	}

	additions := []struct {
		name string
		ddl  string
	}{
		{name: "source_url", ddl: "ALTER TABLE recipes ADD COLUMN source_url TEXT NOT NULL DEFAULT '';"},
		{name: "image_url", ddl: "ALTER TABLE recipes ADD COLUMN image_url TEXT NOT NULL DEFAULT '';"},
	}

	for _, col := range additions {
		if cols[col.name] {
			continue
		}
		if _, err := conn.Exec(col.ddl); err != nil {
			return fmt.Errorf("add column recipes.%s: %w", col.name, err)
		}
	}

	return nil
}

func tableColumns(conn *sql.DB, table string) (map[string]bool, error) {
	rows, err := conn.Query(fmt.Sprintf("PRAGMA table_info(%s);", table))
	if err != nil {
		return nil, fmt.Errorf("inspect columns for %s: %w", table, err)
	}
	defer rows.Close()

	cols := make(map[string]bool)
	for rows.Next() {
		var (
			cid        int
			name       string
			colType    string
			notNull    int
			defaultVal sql.NullString
			pk         int
		)
		if err := rows.Scan(&cid, &name, &colType, &notNull, &defaultVal, &pk); err != nil {
			return nil, fmt.Errorf("scan table_info for %s: %w", table, err)
		}
		cols[name] = true
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate table_info for %s: %w", table, err)
	}

	return cols, nil
}
