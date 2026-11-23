FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run compilar

FROM nginx:1.27-alpine AS runner

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist/equinox/browser /usr/share/nginx/html
COPY docker-entrypoint.sh /docker-entrypoint.d/40-equinox-env.sh

RUN sed -i 's/\r$//' /docker-entrypoint.d/40-equinox-env.sh \
    && chmod +x /docker-entrypoint.d/40-equinox-env.sh

EXPOSE 80

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/nginx-salud >/dev/null || exit 1
