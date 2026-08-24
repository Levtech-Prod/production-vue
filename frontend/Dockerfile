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
# `vite build` copies frontend/public/* into dist/ preserving each source
# file's exact permission bits (Node's fs.cpSync/copyFileSync does this), and
# Docker's COPY carries those bits into the image unchanged. If a file under
# public/ ever ends up non-world-readable on whichever machine builds the
# image (e.g. frontend/public/fonts/*.ttf checked out with 600 instead of
# 644), it silently becomes unreadable here too — nginx's worker process runs
# as the unprivileged `nginx` user (this base image's default), so it can't
# open a root-owned 600 file and serves a 403 for that one asset while
# everything else (freshly written by the bundler, not copied) works fine.
# Normalizing after the copy makes the image correct regardless of what the
# host's permissions happened to be.
RUN chmod -R a+rX /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
