package main

import (
	"database/sql"
	"flag"
	"fmt"
	"log"
	"net"

	"github.com/VTWoods/kiln/recipe"
	_ "github.com/mattn/go-sqlite3"
	"google.golang.org/grpc"
	"google.golang.org/grpc/reflection"
)

var (
	databaseFile = flag.String("sqlite_db", "../bin/kiln.db", "SQLite database file.")
	serverPort   = flag.Int("server_port", 7070, "GRPC server Port.")
)

func main() {
	flag.Parse()
	db, err := sql.Open("sqlite3", *databaseFile)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	lis, err := net.Listen("tcp", fmt.Sprintf("localhost:%d", *serverPort))
	if err != nil {
		log.Fatalf("failed to listen: %v", err)
	}
	var opts []grpc.ServerOption
	grpcServer := grpc.NewServer(opts...)
	recipe.RegisterService(grpcServer, db)
	reflection.Register(grpcServer)
	grpcServer.Serve(lis)
}
