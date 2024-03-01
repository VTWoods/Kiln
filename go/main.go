package main

import (
	"database/sql"
	"flag"
	"log"

	recipepb "github.com/VTWoods/kiln/proto"
	_ "github.com/mattn/go-sqlite3"
)

var (
	databaseFile = flag.String("sqlite_db", "bin/kiln.db", "SQLite database file.")
)

type RecipeServer struct {
	recipepb.UnimplementedRecipeServiceServer
}

func main() {
	flag.Parse()
	db, err := sql.Open("sqlite3", *databaseFile)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()
}
