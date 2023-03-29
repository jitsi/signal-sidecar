FROM --platform=$TARGETPLATFORM node:16-alpine
ARG TARGETPLATFORM
ARG BUILDPLATFORM

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
COPY package*.json ./
RUN apk add --no-cache --virtual .gyp python3 py3-pip make g++ cmake && npm ci && apk del .gyp

# Copy built app
COPY ./dist/. ./dist

# Copy the run script
COPY ./build/run.sh .

# Create default shard state dir
RUN mkdir -p /etc/jitsi

# Run app
EXPOSE 6000 6060
ENV NODE_ENV=production
CMD [ "./run.sh" ]