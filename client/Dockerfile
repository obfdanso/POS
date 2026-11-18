# Build the React app, then serve it with nginx, which also proxies the API to the server container
FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# Vite bakes VITE_* variables into the bundle at build time
ARG VITE_PAYSTACK_PUBLIC_KEY=""
ENV VITE_PAYSTACK_PUBLIC_KEY=$VITE_PAYSTACK_PUBLIC_KEY
ARG VITE_SENTRY_DSN=""
ENV VITE_SENTRY_DSN=$VITE_SENTRY_DSN
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
