# FileServer 设计规格

**日期**: 2026-06-23  
**状态**: 待审核  
**概述**: 局域网文件分发及收集服务，纯浏览器方案，WebRTC P2P 文件传输，中心服务器仅做信令匹配。

---

## 1. 系统目标

fileserver.zelab.top — 同一局域网内用户无需安装客户端，纯浏览器完成文件共享。服务发起者获取 Token 后开启服务，加入者通过 4 位数字码加入，文件通过 WebRTC DataChannel 直传。

## 2. 技术栈

| 层级 | 技术 |
|------|------|
| 前端框架 | Next.js 16 (App Router) |
| 后端 | Next.js API Routes + WebSocket |
| 数据库 | SQLite (better-sqlite3) |
| 文件传输 | WebRTC DataChannel (P2P) |
| 目录选择 | File System Access API |
| Token | 服务端 UUID 生成，有效期 12 小时 |

## 3. 页面结构

### 3.1 介绍页 `/`
- 项目简介 + 两个按钮：「开启服务」「加入服务」
- 点击「加入服务」弹出 4 位码输入框
- 点击「开启服务」→ 后端生成 Token → 直接跳转 `/service?token=xxx`

### 3.2 服务页 `/service?token=xxx`（核心）
两种状态：
- **配置中**: 设置 4 位码、人数上限、是否允许上传、选择共享目录
- **运行中**: 显示在线用户列表、踢出操作、活动记录（可按用户筛选）、关闭服务按钮

### 3.3 加入页 `/join?code=1234`
- Step 1: 输入用户名 → 连接 WebSocket → 发送 join 请求 → 自动加入（4 位码即凭证）
- Step 2: WebRTC 连接建立 → 展示文件列表 → 下载/预览/上传（如允许）

## 4. 数据库设计

### tokens
| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | UUID |
| status | TEXT | unused / used / expired |
| service_id | TEXT FK | 使用后关联 services.id |
| created_at | TEXT | |
| used_at | TEXT | |
| expires_at | TEXT | 创建 + 12 小时 |

### services
| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | UUID |
| token_id | TEXT FK | |
| code | TEXT | 4 位数字码 |
| status | TEXT | configuring / active / closed |
| share_path | TEXT | 目录路径名（仅展示用） |
| max_users | INTEGER | 默认 10 |
| allow_upload | INTEGER | 0/1 |
| current_users | INTEGER | 默认 0 |
| created_at | TEXT | |
| started_at | TEXT | |
| expires_at | TEXT | |

### activity_logs
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 自增 |
| service_id | TEXT FK | |
| user_name | TEXT | |
| action | TEXT | joined / left / kicked / downloaded / uploaded / previewed |
| detail | TEXT | 文件名、大小等 |
| created_at | TEXT | |

## 5. API 设计

### REST API

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| POST | /api/token/create | 生成新 Token | 无 |
| GET | /api/token/status/:id | 查询 Token 状态 | 无 |
| POST | /api/service/register | 注册服务（4位码+配置） | Token |
| GET | /api/service/:code | 查询 4 位码对应的服务状态 | 无 |
| POST | /api/service/start | 开启服务 | Token |
| POST | /api/service/close | 关闭服务 | Token |
| POST | /api/service/kick | 踢出用户 | Token |
| GET | /api/logs/:serviceId | 获取分享记录 | Token |

### WebSocket `/ws`
连接时携带参数区分角色。消息协议如下：

**客户端 → 服务器**:
- `{type:"register", code, token}` — 注册服务
- `{type:"join", code, username}` — 加入服务
- `{type:"signal", target, payload}` — 转发 WebRTC 信令
- `{type:"kick", userId}` — 踢出用户
- `{type:"close"}` — 关闭服务

**服务器 → 客户端**:
- `{type:"signal", from, payload}` — 转发 WebRTC 信令
- `{type:"user-joined", user}` — 有人加入
- `{type:"user-left", userId}` — 用户离开
- `{type:"kicked"}` — 被踢出
- `{type:"service-closed"}` — 服务关闭

## 6. WebRTC 文件传输

### 连接建立
服务发起者 createOffer → 信号通过中心服务器 WebSocket 转发 → 加入者 createAnswer → 服务器回传 → ICE 交换 → DataChannel 建立。

### 分块传输协议
每块 64KB，支持断点续传（重发丢失块）。

消息格式：
- `{type:"file-request", fileId}` — 请求文件
- `{type:"file-response", fileId, name, size, mime, chunks}` — 文件元信息
- `{type:"chunk", fileId, index, total, data}` — 数据块
- `{type:"chunk-ack", fileId, index}` — 确认
- `{type:"upload", name, size, mime, chunks}` — 上传请求
- `{type:"upload-chunk", index, total, data}` — 上传数据块

## 7. Token 生成流程

1. 用户在介绍页点击「开启服务」→ 调用 `/api/token/create` → 后端生成随机 Token（status=unused，有效期 12 小时）
2. 前端获取 Token，直接跳转 `/service?token=xxx`

## 8. 扩展功能

### 8.1 自动过期
- Token: 创建后 12 小时未使用 → 自动标记 expired
- 服务: 服务关闭或 Token 过期 → 断开所有 WebSocket 连接

### 8.2 文件在线预览
- 图片: `<img>` 直接渲染
- PDF: 使用 PDF.js 或 Chrome 内置 PDF Viewer
- 文本/代码: 直接渲染文本内容
- 文件数据通过 WebRTC DataChannel 获取后在浏览器端渲染

### 8.3 分享记录
- 记录所有操作（加入/离开/下载/上传/预览/被踢）
- 服务页实时展示活动日志
- 支持按用户筛选日志

## 9. 边界条件 & 约束

- 服务发起者必须保持浏览器标签页开启，关闭即服务结束
- 服务发起者异常断开（关闭标签页/网络断开）时 WebSocket 自动断开，服务器将服务标记为 closed，通知所有加入者
- 文件不经过服务器，纯 P2P 传输
- 仅支持 Chrome/Edge（File System Access API 兼容性）
- 同局域网 WebRTC 自动使用本地 IP 直连
- 跨网络场景可用但取决于 NAT 穿透（需 STUN 服务器）

## 10. 部署

- 部署到 1Panel/Docker（与兄弟项目一致）
- 环境变量: `DATABASE_PATH`, `TOKEN_EXPIRE_HOURS`(默认12)
- 域名: fileserver.zelab.top，需 HTTPS（WebRTC 要求）
