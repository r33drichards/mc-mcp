FROM node:20-slim

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (use legacy-peer-deps to resolve conflicts)
RUN npm install --legacy-peer-deps

# Copy source code
COPY . .

# Expose ports
# 3002 - Vite dev server / static frontend
# 3003 - CopilotKit runtime server (but we're now using 3007 for agent)
EXPOSE 3002 3003 3007

# Start both the server and serve the built frontend
CMD ["npm", "run", "dev"]
