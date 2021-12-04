FROM node:16-buster-slim

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
RUN npm ci \
    && cp -r /tmp/dist/ .
RUN rm -rf /tmp

# Set start command
CMD ["node", "/app/dist/index.js", "--trace-events-enabled", "--trace-warnings"]
