.PHONY: install build-web build-api build run dev-api dev-web test clean

install:
	go mod tidy
	npm --prefix web install

build-web:
	npm --prefix web run build

build-api:
	go build -o bin/kiln ./cmd/server

build: build-web build-api

run: build-web
	go run ./cmd/server

dev-api:
	go run ./cmd/server

dev-web:
	npm --prefix web run dev

test:
	go test ./...
	npm --prefix web run typecheck

clean:
	rm -rf bin web/dist
