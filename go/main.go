package main

import (
	"context"
	"database/sql"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"

	recipepb "github.com/VTWoods/kiln/proto"
	"github.com/VTWoods/kiln/recipe"
	"github.com/grpc-ecosystem/grpc-gateway/v2/runtime"
	_ "github.com/mattn/go-sqlite3"
	"github.com/rs/cors"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
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
	go grpcServer.Serve(lis)

	ctx := context.Background()
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	// Register gRPC server endpoint
	// Note: Make sure the gRPC server is running properly and accessible
	mux := runtime.NewServeMux()
	dOpts := []grpc.DialOption{grpc.WithTransportCredentials(insecure.NewCredentials())}
	if err = recipepb.RegisterRecipeServiceHandlerFromEndpoint(ctx, mux, "localhost:7070", dOpts); err != nil {
		log.Fatalf("failed to register handler: %v", err)
	}

	// Start HTTP server (and proxy calls to gRPC server endpoint)
	if err = http.ListenAndServe(":8084", cors.Default().Handler(mux)); err != nil {
		log.Fatalf("listen and serve failed: %v", err)
	}
}
