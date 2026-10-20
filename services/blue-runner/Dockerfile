FROM node:20-alpine AS base

WORKDIR /app

FROM base AS deps
COPY package*.json ./
COPY ../../packages/schemas/package*.json ../../packages/schemas/
COPY ../../packages/crypto-utils/package*.json ../../packages/crypto-utils/
RUN npm ci --workspace=@bayora/schemas --workspace=@bayora/crypto-utils --workspace=bayora-blue-runner --ignore-scripts

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/../../packages/schemas/node_modules ../../packages/schemas/node_modules
COPY --from=deps /app/../../packages/crypto-utils/node_modules ../../packages/crypto-utils/node_modules
COPY . .
COPY ../../packages/schemas ../../packages/schemas
COPY ../../packages/crypto-utils ../../packages/crypto-utils
RUN npm run build --workspace=@bayora/schemas --workspace=@bayora/crypto-utils --workspace=bayora-blue-runner

FROM base AS runner
ENV NODE_ENV=production
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/../../packages/schemas/dist ../../packages/schemas/dist
COPY --from=builder /app/../../packages/crypto-utils/dist ../../packages/crypto-utils/dist

EXPOSE 3003
CMD ["node", "dist/index.js"]