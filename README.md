# 蓝奏云直链解析服务 (Cloudflare Worker 版本)

这是一个基于 Cloudflare Worker 的蓝奏云直链解析服务，可以解析蓝奏云的分享链接并获取直链地址。

## 功能特点

- 解析蓝奏云分享链接获取直链
- 三级缓存机制（内存缓存 + D1数据库 + KV存储）
- 自动刷新过期链接
- 支持带密码的分享链接
- 支持定时任务自动刷新
- 支持Cloudflare缓存加速
- 请求合并机制，避免重复处理相同ID的并发请求
- 智能错误处理和重试策略

## 部署方式

### 1. 准备工作

1. 安装 [Wrangler CLI](https://developers.cloudflare.com/workers/cli-wrangler/install-update)
2. 登录 Cloudflare 账户: `wrangler login`

### 2. 创建所需资源

1. 创建 KV Namespace:
   ```bash
   wrangler kv:namespace create "DOWNLOAD_CACHE"
   ```
   将返回的 ID 填入 `wrangler.toml` 文件中

2. 创建 D1 数据库:
   ```bash
   wrangler d1 create lanzou_cache
   ```
   将返回的数据库信息填入 `wrangler.toml` 文件中

3. 初始化 D1 数据库表:
   ```bash
   wrangler d1 execute lanzou_cache --file=./schema.sql
   ```

### 3. 配置文件

更新 `wrangler.toml` 文件中的配置:
- KV Namespace ID
- D1 数据库信息

### 4. 部署

```bash
npm run deploy
```

## 使用方法

### 解析链接

```
GET /{id}[/{password}]
```

示例:
- 无密码链接: `GET /iXXXXXX`
- 带密码链接: `GET /iXXXXXX/password`

### 刷新缓存

```
GET /refresh
```

手动触发刷新任务

### 健康检查

```
GET /health
```

检查服务状态

## 缓存机制

本服务采用三级缓存机制：

1. **内存缓存** - 最快的缓存，5分钟过期
2. **D1数据库** - 持久化存储，15分钟过期
3. **KV存储** - 持久化存储，15分钟过期

数据读取顺序：内存缓存 → D1数据库 → KV存储 → 请求新数据

## 请求合并机制

为了避免在短时间内收到多个相同ID的请求时重复处理，服务实现了请求合并机制：

- 当多个相同ID的请求同时到达时，只会发起一次实际的解析请求
- 其他请求会等待第一个请求完成后，直接使用其结果
- 这可以显著减少对蓝奏云服务器的请求压力，提高响应速度

## 错误处理和重试策略

服务实现了智能的错误处理和重试策略，针对不同类型的错误采用不同的处理方式：

1. **网络错误** - 立即重试，最多3次
2. **超时错误** - 指数退避重试，最多3次
3. **服务器错误(5xx)** - 指数退避重试，最多2次
4. **客户端错误(4xx)** - 不重试
5. **解析错误** - 少量重试

所有重试都添加了抖动（jitter）以避免惊群效应，并限制最大延迟时间为10秒。

## 定时任务

默认每12分钟执行一次刷新任务，检查并更新即将过期的链接。

## 环境变量配置

| 变量名 | 默认值 | 说明 |
|-------|--------|------|
| BATCH_SIZE | 10 | 批处理大小 |
| REFRESH_INTERVAL | 900000 | 刷新间隔（毫秒） |
| URGENT_THRESHOLD | 180000 | 紧急刷新阈值（毫秒） |
| MAX_KEYS_TO_PROCESS | 50 | 每次处理的最大键数 |

## 本地开发

```bash
npm run dev
```

## 许可证

MIT