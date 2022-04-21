FROM node:18-buster-slim

ARG sha
ENV COMMIT_SHA=$sha
ARG environment
ENV ENVIRONMENT=$environment

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
    && apt-get install -yq build-essential python3 git

# Create a folder for compiling
WORKDIR /tmp
COPY package.json .
COPY package-lock.json .
COPY tsconfig.json .
COPY src ./src
RUN npm ci \
    && npm run build

# Prepare production folder
ENV NODE_ENV=production

WORKDIR /app
COPY package.json .
COPY package-lock.json .
COPY strings.json .
RUN npm ci \
    && cp -r /tmp/dist/ .
RUN rm -rf /tmp

# Set start command
CMD ["node", "/app/dist/index.js", "--trace-events-enabled", "--trace-warnings"]
