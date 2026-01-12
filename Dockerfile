FROM node:18

# Install X11 and xvfb dependencies for headless OpenGL rendering
RUN apt-get update -y && \
    apt-get install -y \
    xserver-xorg-dev \
    libxi-dev \
    libxext-dev \
    xvfb \
    libgl1-mesa-dev \
    libgl1-mesa-glx \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

# Copy package files and install dependencies
COPY package.json ./
COPY .npmrc* ./

RUN npm install

# Copy application files
COPY screenshot.js ./

# Create screenshots directory
RUN mkdir -p screenshots

# Environment variables for connection
ENV HOST=""
ENV PORT=""
ENV USERNAME=""
ENV PASSWORD=""

# Run with virtual framebuffer for headless rendering
CMD xvfb-run --auto-servernum --server-num=1 --server-args='-ac -screen 0 1280x1024x24' node screenshot.js $HOST $PORT $USERNAME $PASSWORD
