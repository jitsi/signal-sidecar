#!/bin/bash

if [ -z "$TAG" ]; then
    echo "no TAG set, exiting..."
    exit 2
fi

docker buildx build --no-cache --platform=linux/arm64,linux/amd64 --push --pull --progress=plain --tag aaronkvanmeerten/signal-sidecar:latest --tag aaronkvanmeerten/signal-sidecar:$TAG . 
