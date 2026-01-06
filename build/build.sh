#!/bin/bash

set -x

if [ -z "$IMAGE_TAG" ]; then
    echo "no IMAGE_TAG set, exiting..."
    exit 2
fi

[ -z "$DOCKER_REPO_HOST" ] && DOCKER_REPO_HOST=""

docker buildx build --no-cache --platform=linux/arm64,linux/amd64 --push --pull --progress=plain \
    --tag ${DOCKER_REPO_HOST}jitsi/signal-sidecar:latest \
    --tag ${DOCKER_REPO_HOST}jitsi/signal-sidecar:$IMAGE_TAG . 
