# Build context for this image is the repository root (see docker-compose.yml),
# because frontend/src/types/*.ts imports type-only definitions from
# ../../../backend/src/schemas/*.ts. That relative path has to resolve
# during `vue-tsc -b`, and those schema files import "zod", so a working
# backend/node_modules/zod also needs to be present at build time.
FROM node:22-alpine AS build
WORKDIR /repo

COPY frontend/package*.json frontend/
RUN npm ci --prefix frontend

COPY backend/package*.json backend/
RUN npm ci --prefix backend
COPY backend/src backend/src

COPY frontend frontend

ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL
WORKDIR /repo/frontend
RUN npm run build

FROM nginx:alpine AS production
COPY --from=build /repo/frontend/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
