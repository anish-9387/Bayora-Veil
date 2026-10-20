FROM node:20-alpine AS base

WORKDIR /app

FROM base AS deps
COPY package*.json ./
COPY ../../packages/schemas/package*.json ../../packages/schemas/
RUN npm ci --workspace=@bayora/schemas --workspace=@bayora/web --ignore-scripts

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/../../packages/schemas/node_modules ../../packages/schemas/node_modules
COPY . .
COPY ../../packages/schemas ../../packages/schemas
RUN npm run build --workspace=@bayora/schemas --workspace=@bayora/web

FROM nginx:alpine AS runner
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 5173
CMD ["nginx", "-g", "daemon off;"]