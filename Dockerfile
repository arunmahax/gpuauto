FROM nvidia/cuda:12.4.1-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_ENV=production

# Install system deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates git xz-utils \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 20
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install FFmpeg with NVENC (BtbN static build)
RUN cd /tmp \
    && curl -L -o ffmpeg.tar.xz https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n7.1-latest-linux64-gpl-7.1.tar.xz \
    && tar xf ffmpeg.tar.xz \
    && cp ffmpeg-n7.1-latest-linux64-gpl-7.1/bin/ff* /usr/local/bin/ \
    && rm -rf ffmpeg.tar.xz ffmpeg-n7.1-*

WORKDIR /app

# Install dependencies first (layer cache)
COPY package.json package-lock.json* ./
RUN npm install --production=false

# Copy project
COPY . .

# Create directories
RUN mkdir -p input/uploads output temp assets/backgrounds assets/logos assets/music

EXPOSE 3000

CMD ["npx", "ts-node", "src/server/index.ts"]
