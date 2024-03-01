package main

import (
	"database/sql"
	"flag"
	"log"

	"github.com/vtwoods/kiln/proto/recipepb"
	"github.com/vtwoods/kiln/test"

	_ "github.com/mattn/go-sqlite3"
)

var (
	databaseFile = flag.String("sqlite_db", "bin/kiln.db", "SQLite database file.")
)

type RecipeServer struct {
	recipepb.UnimplementedRecipeServer
}

func main() {
	flag.Parse()
	db, err := sql.Open("sqlite3", *databaseFile)
	if err != nil {
		log.Fatal(err)
	}
	test.Foobar{}
	defer db.Close()
}
