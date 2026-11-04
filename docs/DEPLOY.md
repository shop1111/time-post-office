# 部署到服务器

部署好之后，大家直接打开网址、注册账号就能用。每个账号的数据完全独立，互相看不到。

## 数据是怎么隔离的

每个账号有**自己单独的一份 SQLite 数据库和上传目录**，不和别人共用表：

```
data/
├── auth.db                  账号和登录会话（密码用 scrypt 加盐哈希保存）
├── template.db              空模板，注册时复制一份给新用户
└── users/<用户id>/
    ├── app.db               这个人的胶囊、记忆、信件、收件人、画像……
    └── uploads/             这个人的照片和语音
```

- 每个请求先校验登录 Cookie，再决定连哪个库（`src/lib/auth.ts` 的 `withUser` / `userPage`）。
- 业务代码里的 `db` 只能拿到**当前登录用户**的库；没有登录用户时直接报错，不存在「默认库」，所以不会读写到别人的数据（`src/lib/db.ts`）。
- 照片和语音也按账号存放，`/api/files/...` 只从当前账号自己的目录读文件。
- 「导入示例数据」「清空所有数据」「导出全部数据」都只作用于当前账号。

AI 模型的密钥是服务器级别的，所有账号共用，用户看不到密钥。

## 方式一：Docker（推荐）

```bash
git clone <仓库地址> time-post-office && cd time-post-office
cp .env.example .env
# 编辑 .env：填 CHAT_API_KEY 等密钥；建议设置 INVITE_CODE
docker compose up -d --build
```

服务跑在 `3000` 端口，数据在项目目录下的 `./data`。

升级：

```bash
git pull
docker compose up -d --build   # 启动时会自动把所有用户库同步到新结构
```

## 方式二：直接用 Node.js

需要 Node.js 20 以上。

```bash
npm ci
cp .env.example .env          # 填密钥
npm run build
npm run start:server          # = 同步所有数据库结构 + next start（默认 3000 端口）
```

用 pm2 守护进程：

```bash
npm i -g pm2
pm2 start npm --name time-post-office -- run start:server
pm2 save
```

升级时：`git pull && npm ci && npm run build && pm2 restart time-post-office`。

## 配置项（.env）

| 变量 | 说明 |
| --- | --- |
| `CHAT_API_KEY` 等 | 模型密钥，见 `.env.example`。不填则所有账号都是演示模式 |
| `ALLOW_REGISTRATION` | `1` 开放注册（默认），`0` 关闭注册 |
| `INVITE_CODE` | 填了之后注册必须输入邀请码。**公网部署强烈建议设置**，否则任何人都能注册并消耗你的模型额度 |
| `MAX_USERS` | 账号数量上限，留空不限 |
| `DATA_DIR` | 数据目录，默认 `./data` |
| `COOKIE_SECURE` | 登录 Cookie 的 Secure 标记，默认按访问协议自动判断 |
| `ENABLE_LOCAL_MODEL_SETTINGS` | 公开部署保持 `0` |

改 `.env` 后需要重启服务。

## HTTPS 与反向代理（Nginx 示例）

正式使用请套上 HTTPS（例如用 certbot 申请证书）。小局的回复是流式输出（SSE），代理时要关掉缓冲：

```nginx
server {
    listen 443 ssl http2;
    server_name post.example.com;
    # ssl_certificate / ssl_certificate_key ...

    client_max_body_size 20m;   # 照片、语音上传

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_read_timeout 300s;
    }
}
```

`X-Forwarded-Proto` 必须转发，服务据此给登录 Cookie 加上 Secure；`X-Forwarded-For` 用于登录限流。

## 备份

所有数据都在 `data/` 目录里，备份就是复制这个目录（最好先停服务，或者在访问少的时候做）：

```bash
tar czf backup-$(date +%F).tgz data
```

## 常用运维命令

```bash
npm run db:push                         # 改了 prisma/schema.prisma 后，同步所有库的结构
npm run seed -- <用户名>                 # 给某个账号导入示例数据（会替换他现有的数据）
npm run user:adopt-legacy -- <用户名>    # 把单用户版本的 data/app.db 和 data/uploads 归到某个账号下
```

### 从单用户版本迁移

以前的版本所有数据都在 `data/app.db`。想保留这些数据：

1. 部署新版本，用网页注册一个账号（比如 `me`）。
2. 停掉服务，运行 `npm run user:adopt-legacy -- me`。
3. 运行 `npm run db:push`，再启动服务。登录 `me` 就能看到原来的胶囊和信件。

## 规模说明

每个账号一个 SQLite 文件，适合几十到几百人的规模。进程会缓存打开的用户库，闲置 30 分钟自动关闭（`MAX_OPEN_USER_DBS` 可调整同时打开的上限，默认 200）。
限流、追问锁等状态保存在进程内存里，所以请只跑**一个**服务进程（不要用 pm2 cluster 模式开多个实例）。
