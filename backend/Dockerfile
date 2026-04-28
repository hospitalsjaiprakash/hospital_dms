FROM node:20-alpine AS base

RUN apk add --no-cache dumb-init

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

COPY src ./src

RUN mkdir -p logs

EXPOSE 5000

USER node

CMD ["dumb-init", "node", "src/index.js"]
