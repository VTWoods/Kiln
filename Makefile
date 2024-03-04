
apply_db:
	atlas schema apply \
		--auto-approve \
		-u "sqlite3://bin/kiln.db" \
		--to file://database/schema.sql \
		--dev-url "sqlite://dev?mode=memory"

run_server: compile_pb
	cd go; go run main.go

run_fe:
	cd kiln-app; npm run web

compile_pb:
	rm go/proto/* || true
	protoc -I=proto --go_opt=paths=source_relative --go_out=go/proto --go-grpc_out=go/proto --go-grpc_opt=paths=source_relative proto/*
	protoc -I=proto --grpc-gateway_out=go/proto \
    	--grpc-gateway_opt paths=source_relative \
    	--grpc-gateway_opt generate_unbound_methods=true \
    	proto/*

deps:
	go install \
    	github.com/grpc-ecosystem/grpc-gateway/v2/protoc-gen-grpc-gateway \
    	github.com/grpc-ecosystem/grpc-gateway/v2/protoc-gen-openapiv2 \
    	google.golang.org/protobuf/cmd/protoc-gen-go \
    	google.golang.org/grpc/cmd/protoc-gen-go-grpc