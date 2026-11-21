.PHONY: install migrate build-web build run dev-api dev-web test clean docker-build docker-run docker-stop

PYTHON ?= ./.venv/bin/python3
HOST ?= 0.0.0.0
PORT ?= 8080
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
	.venv/bin/gunicorn kiln_project.wsgi:application --bind $(HOST):$(PORT) --workers 2 --threads 4

dev-api: migrate
	DJANGO_DEBUG=true $(PYTHON) manage.py runserver $(HOST):$(PORT)

dev-web:
	npm --prefix web run dev

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
