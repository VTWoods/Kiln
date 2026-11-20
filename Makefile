.PHONY: install build-web build-api build run dev-api dev-web test clean docker-build docker-run docker-stop

DOCKER_IMAGE ?= kiln:latest
DOCKER_CONTAINER ?= kiln
DOCKER_PORT ?= 8090
DOCKER_VOLUME ?= kiln-data:/data

install:
	go mod tidy
	npm --prefix web install
	python3 -m venv .venv
	.venv/bin/pip install -r scripts/requirements.txt

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

docker-build:
	docker build -t $(DOCKER_IMAGE) .

docker-run: docker-build
	-docker rm -f $(DOCKER_CONTAINER) 2>/dev/null || true
	docker run -d \
		--name $(DOCKER_CONTAINER) \
		-p $(DOCKER_PORT):8080 \
		-v $(DOCKER_VOLUME) \
		--restart unless-stopped \
		$(DOCKER_IMAGE)

docker-stop:
	docker rm -f $(DOCKER_CONTAINER)
