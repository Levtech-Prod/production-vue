FROM node:22-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
# The maintenance scripts (uploads migration, folder-name resync) are compiled
# and shipped too — the production stage has no tsx to run them from source.
COPY scripts ./scripts
RUN npm run build

FROM node:22-alpine AS production
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY --from=build /app/dist ./dist
COPY database ./database
RUN mkdir -p uploads

EXPOSE 4000
CMD ["node", "dist/src/server.js"]
