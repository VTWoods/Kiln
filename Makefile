
apply_db:
	atlas schema apply \
		--auto-approve \
		-u "sqlite3://bin/kiln.db" \
		--to file://database/schema.sql \
		--dev-url "sqlite://dev?mode=memory"

run_server: compile_pb
	cd go; go run main.go

compile_pb:
	rm go/proto/* || true
	protoc -I=proto --go_opt=paths=source_relative --go_out=go/proto --go-grpc_out=go/proto --go-grpc_opt=paths=source_relative proto/*

