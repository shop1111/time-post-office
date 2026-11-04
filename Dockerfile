# 时光邮局：一个容器跑完整服务，数据放在挂载的 /app/data 卷里
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
COPY prisma ./prisma
# 构建和启动时都要用到 prisma 命令行（同步数据库结构），所以保留 devDependencies
RUN npm ci

COPY . .
RUN npx prisma generate && npm run build

ENV NODE_ENV=production
ENV DATA_DIR=/app/data
EXPOSE 3000
VOLUME ["/app/data"]

# 每次启动先把所有用户库同步到最新结构，再启动服务
CMD ["sh", "-c", "node scripts/db-sync.mjs && npx next start -H 0.0.0.0 -p 3000"]
