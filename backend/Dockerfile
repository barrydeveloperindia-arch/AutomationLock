# Dockerfile for Smart Door Lock Backend
FROM node:18-alpine

# Install build dependencies for bcrypt/native modules if needed
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies
RUN npm install --omit=dev

# Copy source code
COPY . .

# Expose port
EXPOSE 8000

# Start application
CMD ["node", "server.js"]
