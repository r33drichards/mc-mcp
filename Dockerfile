FROM node:20

# Install X11 dependencies for headless WebGL rendering
RUN apt-get update -y && \
    apt-get install -y \
    xserver-xorg-dev \
    libxi-dev \
    libxext-dev \
    xvfb \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

# Copy package files first for better caching
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm install

# Copy source files
COPY . .

# Build TypeScript
RUN npm run build

# Create screenshots directory for output
RUN mkdir -p /usr/src/app/screenshots

# Environment variables (can be overridden at runtime)
ENV MC_HOST=localhost
ENV MC_PORT=25565
ENV MC_USERNAME=mcp-bot
ENV MC_AUTH=offline

# Run the MCP server with xvfb for headless WebGL
# The server communicates via stdio, so we use exec to replace the shell
CMD ["xvfb-run", "--auto-servernum", "--server-num=1", "--server-args=-ac -screen 0 1280x1024x24", "node", "dist/index.js"]
