FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/erp-core/package.json ./apps/erp-core/

RUN npm ci --workspace=apps/erp-core

COPY apps/erp-core ./apps/erp-core
RUN npm --prefix apps/erp-core run build

FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/erp-core/package.json ./apps/erp-core/

RUN npm ci --omit=dev --workspace=apps/erp-core

COPY --from=builder /app/apps/erp-core/dist ./apps/erp-core/dist
COPY apps/erp-core/client ./apps/erp-core/client

EXPOSE 3000

CMD ["node", "apps/erp-core/dist/index.js"]
