.PHONY: install migrate build-web build run dev dev-api dev-web dev-caddy test clean docker-build docker-run docker-stop

PYTHON ?= ./.venv/bin/python3
HOST ?= 0.0.0.0
PORT ?= 8091
API_PORT ?= $(PORT)
WEB_PORT ?= 8090
CADDY_ADDR ?= https://localhost:8443
HMR_CLIENT_PORT ?= 443
DOCKER_IMAGE ?= kiln:latest
DOCKER_CONTAINER ?= kiln
DOCKER_PORT ?= 8090
DOCKER_VOLUME ?= kiln-data:/data

install:
	python3 -m venv .venv
	.venv/bin/pip install -r requirements.txt
	.venv/bin/python3 -m nltk.downloader -d .venv/nltk_data averaged_perceptron_tagger_eng wordnet
	npm --prefix web install

migrate:
	$(PYTHON) manage.py migrate --fake-initial

build-web:
	npm --prefix web run build

build: build-web

run: build-web migrate
	.venv/bin/gunicorn kiln_project.wsgi:application --bind $(HOST):$(PORT) --workers 2 --threads 4 --timeout 120

dev-api: migrate
	DJANGO_DEBUG=true $(PYTHON) manage.py runserver $(HOST):$(API_PORT)

dev-web:
	API_PORT=$(API_PORT) WEB_PORT=$(WEB_PORT) npm --prefix web run dev

dev-caddy:
	KILN_CADDY_ADDR=$(CADDY_ADDR) API_PORT=$(API_PORT) WEB_PORT=$(WEB_PORT) caddy run --config examples/Caddyfile.dev --adapter caddyfile

# Start both Django (:8091) and Vite (:8090) configured for HTTPS behind Caddy (HMR over wss://)
dev: migrate
	@set -e; \
	trap 'kill 0' EXIT INT TERM; \
	DJANGO_DEBUG=true $(PYTHON) manage.py runserver $(HOST):$(API_PORT) & \
	API_PORT=$(API_PORT) WEB_PORT=$(WEB_PORT) VITE_HMR_CLIENT_PORT=$(HMR_CLIENT_PORT) npm --prefix web run dev & \
	wait

test:
	$(PYTHON) manage.py test -v 2
	npm --prefix web run typecheck

clean:
	rm -rf web/dist

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
