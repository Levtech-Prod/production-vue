# Build context for this image is the repository root (see docker-compose.yml),
# because the frontend imports from backend/src: type-only definitions in
# frontend/src/types/*.ts, plus the part-name resolver (a real runtime import,
# see PartModal.vue). Those relative paths have to resolve during `vue-tsc -b`
# and `vite build`, and the schema files import "zod", so a working
# backend/node_modules/zod also needs to be present at build time.
FROM node:22-alpine AS build
WORKDIR /repo

COPY frontend/package*.json frontend/
RUN npm ci --prefix frontend --no-audit --no-fund

COPY backend/package*.json backend/
RUN npm ci --prefix backend --no-audit --no-fund
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
