# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json vitest.config.ts vite.web.config.mts ./
COPY src/ src/
COPY data/ data/

RUN npm run build
RUN npx vite build --config vite.web.config.mts

# Stage 2: Production
FROM node:20-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache tini

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist/ dist/
COPY --from=builder /app/src/db/schema.sql src/db/schema.sql
COPY --from=builder /app/src/db/migrations/ src/db/migrations/
COPY --from=builder /app/data/ data/

# Database stored outside container
VOLUME ["/root/.attesting"]

ENV NODE_ENV=production
ENV ATTESTING_PORT=3000
EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js", "serve", "--port", "3000"]
