FROM mcr.microsoft.com/powershell:lts-debian-buster-slim

# From https://github.com/nodejs/docker-node/blob/main/14/buster/Dockerfile
RUN groupadd --gid 1000 node \
  && useradd --uid 1000 --gid node --shell /bin/bash --create-home node

ENV NODE_VERSION 14.16.1

RUN curl -fsSL https://deb.nodesource.com/setup_14.x | bash - \
  apt-get install -y nodejs

# Additional dependencies          
RUN apt-get install -y \
	python3 \
	ffmpeg \
	git

RUN wget https://yt-dl.org/downloads/latest/youtube-dl -O /usr/local/bin/youtube-dl \
	&& chmod a+rx /usr/local/bin/youtube-dl \
	&& ln -s $(which python3) /usr/bin/python

# Discord bot
# Create a folder for the bot
WORKDIR /app
COPY package.json .
COPY package-lock.json .

# Install packages
RUN npm ci

# Copy remaining files except files in .dockerignore
COPY . .

# Set start command
CMD ["node", "index.js", "--trace-events-enabled", "--trace-warnings"]
