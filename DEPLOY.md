# FileServer 部署文档（1Panel）

## 项目概述

FileServer 是一个基于浏览器的局域网文件共享服务。一端开启服务、选择文件夹，另一端输入 4 位码即可加入，进行文件下载和上传。

**技术栈：** Next.js 16 + TypeScript + SQLite + WebSocket

---

## 前置准备

在 1Panel 面板中：

### 1. 安装 Node.js 运行环境

`应用商店` → 搜索 `Node.js` → 安装（推荐 18.x 或 20.x）

### 2. 检查编译工具

`better-sqlite3` 是原生模块，需要编译。1Panel 的 Node.js 容器通常已内置 `build-essential`。如果安装依赖时报错，通过终端执行：

```bash
apt-get update && apt-get install -y build-essential python3
```

---

## 部署步骤

### 1. 上传项目

两种方式任选：

**方式 A：上传压缩包**

将项目文件夹打包为 `.tar.gz`：
```bash
# 在本地项目目录执行
tar --exclude='node_modules' --exclude='.next' --exclude='data' -czf fileserver.tar.gz .
```

然后进入 1Panel → `网站` → 点击项目目录 → `上传` 并解压。

**方式 B：Git 克隆**

```bash
cd /opt/1panel/apps/nodejs/  # 或你的实际路径
git clone <你的仓库地址> fileserver
```

---

### 2. 创建 Node.js 网站

`网站` → `创建网站` → 选择 `运行环境`：

| 配置项 | 值 |
|--------|-----|
| 类型 | Node.js |
| Node.js 版本 | 18 或 20 |
| 项目目录 | 选择上传/克隆的 fileserver 目录 |
| 启动命令 | `npx tsx server.ts` |
| 端口 | `3000` |

#### 环境变量

在网站设置中添加：

| 变量名 | 值 | 说明 |
|--------|-----|------|
| `NODE_ENV` | `production` | 生产模式 |
| `DATABASE_PATH` | `data/fileserver.db` | 数据库路径 |
| `TOKEN_EXPIRE_HOURS` | `12` | Token 有效期 |
| `PORT` | `3000` | 监听端口 |

---

### 3. 安装依赖

进入项目目录，在终端中执行：

```bash
npm install
```

等待 `better-sqlite3` 编译完成。看到 `Successfully installed` 即可。

如果编译失败，参考文档末尾"[常见问题](#常见问题)"第 1 条。

---

### 4. 创建数据目录

```bash
mkdir -p data
chmod 755 data
```

数据库文件 `fileserver.db` 会在首次运行时自动创建，无需手动操作。

---

### 5. 启动服务

在 1Panel 网站管理中点击 `启动`，或通过终端：

```bash
npx tsx server.ts
```

点击 `网站` → `日志` 确认输出：

```
> Ready on http://0.0.0.0:3000
```

---

## 反向代理配置

1Panel 内置 OpenResty（Nginx）。创建网站时已自动生成基础反向代理，需要手动添加 WebSocket 支持。

### 1. 进入反向代理配置

`网站` → 点击你的网站 → `反向代理` → 编辑已有配置，或 `创建反向代理`：

```
代理名称：fileserver
代理地址：http://127.0.0.1:3000
```

### 2. 配置源文

在反向代理的 `源文`（Raw Config）中，替换为以下内容：

```nginx
# WebSocket 代理（必须放在 / 之前）
location /ws {
    proxy_pass http://127.0.0.1:3000;
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

location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 300s;
}
```

> **关键：** `/ws` 必须在 `/` 之前，确保 WebSocket 请求优先匹配。

### 3. 验证

保存后检查配置是否生效：

```bash
# HTTP
curl -s -o /dev/null -w "%{http_code}" http://你的域名

# WebSocket（安装 wscat）
npx wscat -c ws://你的域名/ws
# 看到 Connected 即正常
```

---

## SSL / HTTPS

`网站` → `HTTPS` → `启用 HTTPS` → 选择 `自动申请 Let's Encrypt 证书`。

1Panel 会自动完成证书申请、安装和续签。

---

## 备份

SQLite 数据库是唯一的持久化数据，路径为项目目录下的 `data/fileserver.db`。

**1Panel 面板备份：**

`计划任务` → `创建计划任务`：

| 配置项 | 值 |
|--------|-----|
| 任务类型 | 备份 |
| 备份范围 | 选择 fileserver 项目目录 |
| 保留份数 | 7 |
| 执行周期 | 每天 03:00 |

**手动备份：**

```bash
# 进入项目目录
sqlite3 data/fileserver.db ".backup data/fileserver-$(date +%Y%m%d).db"
```

---

## 升级

```bash
# 1. 停止服务
# 在 1Panel 网页管理中点击「停止」

# 2. 拉取最新代码
cd /你的项目目录
git pull

# 3. 更新依赖
npm install

# 4. 重新启动
# 在 1Panel 网页管理中点击「启动」
```

---

## 常见问题

### 1. better-sqlite3 编译失败

**症状：** `npm install` 报 `node-gyp` 相关错误

**解决：**

```bash
# 确保编译工具已安装
apt-get update && apt-get install -y build-essential python3

# 清理后重装
rm -rf node_modules
npm install
```

如果是 ARM 架构（树莓派等），额外装：

```bash
apt-get install -y g++ make
```

### 2. WebSocket 连接不上（wss://）

**症状：** 加入服务后看不到文件，浏览器控制台 WebSocket 报错

**排查：**

1. 确认反向代理 `/ws` location 在 `/` **之前**
2. 确认 `/ws` 块包含 `proxy_set_header Upgrade` 和 `Connection "upgrade"`
3. 如果启用了 HTTPS，确认客户端使用 `wss://` 协议（代码自动处理，无需手动改）

### 3. 页面刷新后状态丢失

**症状：** 开启服务后刷新页面，服务不再运行

**原因：** 刷新页面会关闭 WebSocket 连接，当前版本刷新后需要重新配置服务。后续版本计划支持断线重连。

**变通方案：** 刷新后，使用同一 Token 重新进入 `/service?token=xxx`。

### 4. HTTPS 下 `showDirectoryPicker` 不可用

**症状：** 无法选择共享目录

**原因：** File System Access API 要求 secure context。1Panel 启用 HTTPS 后即可正常使用。

### 5. 端口冲突

**症状：** 启动报 `EADDRINUSE`

**解决：** 检查是否有其他服务占用 3000 端口，或在环境变量中修改 `PORT` 为其他值并同步更新反向代理的 `proxy_pass`。

### 6. 内存不足

**症状：** 传输大文件时服务崩溃

**说明：** 当前版本文件通过 WebSocket 传输，大文件会完整加载到内存。建议传输文件不超过 500MB。未来版本将支持分块传输。

### 7. 数据库锁定

**症状：** `SQLITE_BUSY` 错误

**说明：** 项目已启用 WAL 模式，正常情况下不会出现。如在高并发场景下出现，可通过环境变量延长超时：

```bash
# 一般不需要设置
SQLITE_BUSY_TIMEOUT=5000
```
