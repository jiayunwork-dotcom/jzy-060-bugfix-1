# syntax=docker/dockerfile:1

# ---- 阶段 1：安装全部工作区依赖（含 devDeps，容器内可直接跑测试） ----
FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY server/package.json ./server/package.json
COPY web/package.json ./web/package.json
RUN npm install --no-audit --no-fund

# ---- 阶段 2：构建前端与后端 ----
FROM deps AS build
WORKDIR /app
COPY . .
RUN npm run build --workspace web && npm run build --workspace server

# ---- 阶段 3：运行镜像（前后端一体，后端静态托管前端产物） ----
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    DATA_DIR=/app/data \
    PORT=8080 \
    WEB_DIST=/app/web/dist \
    TICK_MS=1000 \
    HISTORY_RETENTION_MS=86400000 \
    ENABLE_TEST_API=false
COPY --from=build /app ./
EXPOSE 8080
VOLUME ["/app/data"]
CMD ["node", "server/dist/index.js"]
