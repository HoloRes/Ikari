FROM mcr.microsoft.com/powershell:alpine-3.11

# From https://github.com/nodejs/docker-node/blob/master/14/alpine3.11/Dockerfile
ENV NODE_VERSION 14.15.5

RUN addgroup -g 1000 node \
	&& adduser -u 1000 -G node -s /bin/sh -D node \
	&& apk add --no-cache \
	libstdc++ \
	&& apk add --no-cache --virtual .build-deps \
	curl \
	&& ARCH= && alpineArch="$(apk --print-arch)" \
	&& case "${alpineArch##*-}" in \
	x86_64) \
	ARCH='x64' \
	CHECKSUM="e7ca0569963c3155d86c51b3855469c3496f0c8d2fce080480d92de5a6287977" \
	;; \
	*) ;; \
	esac \
	&& if [ -n "${CHECKSUM}" ]; then \
	set -eu; \
	curl -fsSLO --compressed "https://unofficial-builds.nodejs.org/download/release/v$NODE_VERSION/node-v$NODE_VERSION-linux-$ARCH-musl.tar.xz"; \
	echo "$CHECKSUM  node-v$NODE_VERSION-linux-$ARCH-musl.tar.xz" | sha256sum -c - \
	&& tar -xJf "node-v$NODE_VERSION-linux-$ARCH-musl.tar.xz" -C /usr/local --strip-components=1 --no-same-owner \
	&& ln -s /usr/local/bin/node /usr/local/bin/nodejs; \
	else \
	echo "Building from source" \
	# backup build
	&& apk add --no-cache --virtual .build-deps-full \
	binutils-gold \
	g++ \
	gcc \
	gnupg \
	libgcc \
	linux-headers \
	make \
	python3 \
	# gpg keys listed at https://github.com/nodejs/node#release-keys
	&& for key in \
	4ED778F539E3634C779C87C6D7062848A1AB005C \
	94AE36675C464D64BAFA68DD7434390BDBE9B9C5 \
	74F12602B6F1C4E913FAA37AD3A89613643B6201 \
	71DCFD284A79C3B38668286BC97EC7A07EDE3FC1 \
	8FCCA13FEF1D0C2E91008E09770F7A9A5AE15600 \
	C4F0DFFF4E8C1A8236409D08E73BC641CC11F4C8 \
	C82FA3AE1CBEDC6BE46B9360C43CEC45C17AB93C \
	DD8F2338BAE7501E3DD5AC78C273792F7D83545D \
	A48C2BEE680E841632CD4E44F07496B3EB3C1762 \
	108F52B48DB57BB0CC439B2997B01419BD92F80A \
	B9E2F5981AA6E0CD28160D9FF13993A75599653C \
	; do \
	gpg --batch --keyserver hkp://p80.pool.sks-keyservers.net:80 --recv-keys "$key" || \
	gpg --batch --keyserver hkp://ipv4.pool.sks-keyservers.net --recv-keys "$key" || \
	gpg --batch --keyserver hkp://pgp.mit.edu:80 --recv-keys "$key" ; \
	done \
	&& curl -fsSLO --compressed "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION.tar.xz" \
	&& curl -fsSLO --compressed "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt.asc" \
	&& gpg --batch --decrypt --output SHASUMS256.txt SHASUMS256.txt.asc \
	&& grep " node-v$NODE_VERSION.tar.xz\$" SHASUMS256.txt | sha256sum -c - \
	&& tar -xf "node-v$NODE_VERSION.tar.xz" \
	&& cd "node-v$NODE_VERSION" \
	&& ./configure \
	&& make -j$(getconf _NPROCESSORS_ONLN) V= \
	&& make install \
	&& apk del .build-deps-full \
	&& cd .. \
	&& rm -Rf "node-v$NODE_VERSION" \
	&& rm "node-v$NODE_VERSION.tar.xz" SHASUMS256.txt.asc SHASUMS256.txt; \
	fi \
	&& rm -f "node-v$NODE_VERSION-linux-$ARCH-musl.tar.xz" \
	&& apk del .build-deps \
	# smoke tests
	&& node --version \
	&& npm --version

# Additional dependencies          
RUN apk add --no-cache \
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
