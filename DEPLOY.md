# FileServer 部署指南

## 项目说明

FileServer 是一个基于浏览器的局域网文件共享服务。一端开启服务、选择文件夹并生成 4 位加入码，另一端输入加入码即可进行文件下载和上传，通过 WebSocket 实时同步。

**技术栈：** Express + sql.js（纯 JS SQLite）+ WebSocket (ws) + 原生 HTML/JS，无构建步骤。

此应用通过子域名 `https://fileserver.你的域名.com/` 访问。

> **架构说明**：sql.js 是 SQLite 编译为 WebAssembly 的纯 JS 实现，无需任何原生编译。Express + 静态页面，`npm install` 秒装，2 核 2G 服务器完全够用。

## 1. 准备工作

### 1.1 服务器要求

已安装 1Panel + OpenResty（详见根目录 `DEPLOY.md`）。

### 1.2 DNS 配置

在域名 DNS 管理后台添加一条 A 记录：

| 主机记录 | 记录类型 | 记录值 |
|---------|---------|--------|
| `fileserver` | A | `<服务器公网IP>` |

> 如果使用 CDN（如 Cloudflare），SSL 证书申请期间需关闭橙色云朵（仅 DNS 模式）。

### 1.3 端口规划

| 环境 | 端口 | 说明 |
|------|------|------|
| 容器内 | 3000 | Express 应用监听端口 |
| 宿主机映射 | 3003 | 外部访问端口，不与其他应用冲突 |

> 与现有应用端口不冲突，详见根目录 `DEPLOY.md`。

## 2. 部署方式

两种方式任选。**方式一更简单**（服务器直接 npm start），方式二适合 Docker 隔离。

### 方式一：1Panel Node.js 运行环境（推荐，最简）

sql.js 是纯 JavaScript，`npm install` 秒装，无需编译。

#### Step 1：上传代码

```bash
mkdir -p /opt/fileserver
# 在本地执行：
scp -r server.js package.json package-lock.json src/ public/ root@<IP>:/opt/fileserver/
```

> **不要上传** `node_modules`、`data/`、`.env.local`、`.git`。

#### Step 2：创建运行环境

1Panel → **「网站」** → **「运行环境」** → **「创建运行环境」**：

| 配置项 | 值 |
|--------|-----|
| 名称 | `fileserver` |
| 应用 | `Node.js` |
| 版本 | `22` |
| 源码目录 | `/opt/fileserver` |
| 启动命令 | `node server.js` |
| 安装命令 | `npm install` |
| 应用端口 | `3000` |
| 外部映射端口 | `3003` |
| 包管理器 | `npm` |

#### Step 3：配置环境变量

在运行环境详情 → **「编辑」** → **「环境变量」**：

| 变量名 | 值 |
|--------|-----|
| `NODE_ENV` | `production` |
| `DATABASE_PATH` | `data/fileserver.db` |
| `TOKEN_EXPIRE_HOURS` | `12` |
| `PORT` | `3000` |

#### Step 4：启动并验证

```bash
curl http://127.0.0.1:3003/
```

### 方式二：Docker Compose

#### Step 1：本地构建并上传

```bash
docker build --platform linux/amd64 -t fileserver:latest .
docker save fileserver:latest | gzip > fileserver.tar.gz
scp fileserver.tar.gz docker-compose.yml root@<IP>:/opt/fileserver/
```

> 镜像仅 ~80MB，无原生编译，构建极快。

#### Step 2：服务器加载运行

```bash
cd /opt/fileserver
docker load < fileserver.tar.gz
mkdir -p data
docker compose up -d
```

或通过 1Panel → **「容器」** → **「编排」** → 创建编排。

#### docker-compose.yml

```yaml
services:
  fileserver:
    image: fileserver:latest
    container_name: fileserver
    ports:
      - "3003:3000"
    volumes:
      - ./data:/app/data
    environment:
      - NODE_ENV=production
      - DATABASE_PATH=data/fileserver.db
      - TOKEN_EXPIRE_HOURS=12
      - PORT=3000
    restart: unless-stopped
```

## 3. OpenResty 反向代理配置

> 以下操作基于 1Panel v2 版本。

### 3.1 创建反向代理网站

1Panel → **「网站」** → **「创建网站」** → **「反向代理」**：

| 配置项 | 值 |
|--------|-----|
| 主域名 | `fileserver.你的域名.com` |
| 代理地址 | `127.0.0.1:3003` |

### 3.2 添加 WebSocket 代理

1. 1Panel → **「网站」** → 点击 `fileserver.你的域名.com` → **「配置」** → **「配置文件」**
2. 在 `location /` 块**之前**添加：

```nginx
location /ws {
    proxy_pass http://127.0.0.1:3003;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 86400s;
    proxy_buffering off;
}
```

3. 确认 `location /` 块：

```nginx
location / {
    proxy_pass http://127.0.0.1:3003/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_http_version 1.1;
}
```

4. 点击 **「保存」**

> **关键**：`/ws` 必须在 `/` 之前，确保 WebSocket 升级请求优先匹配。

### 3.3 验证

```bash
curl -s -o /dev/null -w "%{http_code}" http://fileserver.你的域名.com/
# 应返回 200
```

## 4. SSL 证书（HTTPS）

> FileServer 依赖 File System Access API 选择共享文件夹，该 API 要求 secure context，因此 HTTPS 是必需的。

### 申请证书

1. 1Panel → **「网站」** → 点击 `fileserver.你的域名.com` → **「配置」** → **「HTTPS」** → **「申请证书」**
2. 证书类型：Let's Encrypt，验证方式：HTTP 验证，开启自动续签
3. 证书申请成功后，启用 HTTPS，选择 **「禁止 HTTP」** 强制跳转

> 如果服务器已有泛域名证书（`*.你的域名.com`），可直接使用，详见根目录 `DEPLOY.md`。

## 5. 数据库备份

SQLite 数据文件：`/opt/fileserver/data/fileserver.db`

### 定时备份（1Panel 计划任务）

1Panel → **「计划任务」** → **「创建计划任务」**：

| 配置项 | 值 |
|--------|-----|
| 任务名称 | 备份 FileServer 数据库 |
| 执行周期 | 每天 3:00 |

脚本内容：

```bash
#!/bin/bash
BACKUP_DIR="/opt/backups/fileserver"
mkdir -p "$BACKUP_DIR"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

# 方式一（运行环境）：直接复制
cp /opt/fileserver/data/fileserver.db "$BACKUP_DIR/fileserver-$TIMESTAMP.db"

# 方式二（Docker）：
# docker cp fileserver:/app/data/fileserver.db "$BACKUP_DIR/fileserver-$TIMESTAMP.db"

# 保留最近 7 天
find "$BACKUP_DIR" -name "fileserver-*.db" -mtime +7 -delete

echo "备份完成: fileserver-$TIMESTAMP.db"
```

### 恢复

```bash
cp /path/to/backup/fileserver-YYYYMMDD.db /opt/fileserver/data/fileserver.db
# 然后重启运行环境
```

## 6. 更新部署

```bash
# 1. 上传更新的文件
scp -r server.js src/ public/ root@<IP>:/opt/fileserver/

# 2. 方式一：1Panel → 网站 → 运行环境 → fileserver → 重启
#    方式二：cd /opt/fileserver && docker compose down && docker compose up -d --build
```

## 7. 验证清单

部署完成后验证：

- [ ] DNS 解析生效：`nslookup fileserver.你的域名.com` 返回服务器 IP
- [ ] `https://fileserver.你的域名.com/` 正常显示首页
- [ ] 点击「开启服务」→ 选择文件夹 → 生成 4 位加入码
- [ ] 另一浏览器输入加入码 → 加入成功 → 文件列表可见
- [ ] 文件下载正常
- [ ] 文件上传正常（需勾选「允许加入者上传文件」）
- [ ] DevTools → Network → WS → `/ws` 状态 101 Switching Protocols
- [ ] HTTPS 证书生效，浏览器显示安全锁

## 8. 故障排查

### 容器 / 运行环境启动失败

```bash
# 查看日志：1Panel → 网站 → 运行环境 → fileserver → 日志
# 或 docker compose logs fileserver
```

### WebSocket 连接失败（wss://）

1. 确认 Nginx 中 `/ws` location 在 `/` 之前
2. 确认 `/ws` 块包含 `Upgrade` 和 `Connection "upgrade"` header

### HTTPS 下文件夹选择不可用

确认已启用 HTTPS（File System Access API 要求 secure context）。

### 502 Bad Gateway

- 检查运行环境 / 容器是否运行
- 检查 `proxy_pass` 地址和端口（127.0.0.1:3003）

### 上传文件失败

如果浏览器控制台报错 `User activation is required`，说明 File System Access API 的读写权限未持久化。确保服务端在选择目录后立即调用 `requestPermission({ mode: 'readwrite' })`（当前代码已处理）。

## 附录：项目文件结构

```
/opt/fileserver/
├── server.js              # Express + WebSocket 入口
├── package.json
├── package-lock.json
├── src/
│   ├── db.js              # sql.js 数据库层（纯 JS，无需编译）
│   ├── ws-handler.js      # WebSocket 消息处理
│   └── routes/
│       ├── token.js       # Token API
│       ├── service.js     # 服务 API
│       └── logs.js        # 活动日志 API
├── public/
│   ├── index.html         # 首页
│   ├── service.html       # 服务端页面
│   ├── join.html          # 加入端页面
│   ├── css/
│   │   └── style.css
│   ├── js/
│   │   ├── app.js         # 共享工具
│   │   ├── home.js        # 首页逻辑
│   │   ├── service.js     # 服务端逻辑
│   │   └── join.js        # 加入端逻辑
│   └── logo.png
├── Dockerfile
├── docker-compose.yml
├── .dockerignore
└── data/
    └── fileserver.db      # SQLite 数据库（自动创建）
```
