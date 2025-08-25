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

```
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

### 直接使用 Wrangler (推荐)

```bash
# 确保你使用 Node.js 20 或更高版本
node --version

# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 启动带指定端口和IP的开发服务器
npm run dev:local
```

### 使用 DevContainer (解决 macOS 兼容性问题)

如果您的 macOS 版本低于 13.5.0，Cloudflare Workers 可能无法在本地运行。在这种情况下，您可以使用 DevContainer：

1. 安装 [Docker Desktop](https://www.docker.com/products/docker-desktop/)
2. 安装 [Visual Studio Code](https://code.visualstudio.com/)
3. 安装 VS Code 的 [Remote - Containers](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers) 扩展
4. 打开项目文件夹并选择 "Reopen in Container" 选项

或者，如果您不使用 VS Code，可以直接使用 Docker 运行 DevContainer 环境：

```bash
# 构建 DevContainer 镜像
docker build -t lanzou-devcontainer .devcontainer/

# 运行 DevContainer
docker run -it --rm -p 8787:8787 -v $(pwd):/workspace lanzou-devcontainer
```

### 使用 Docker 进行本地开发

```bash
# 构建并启动 Docker 容器 (使用 Ubuntu 22.04，包含所需的 GLIBC 版本)
npm run dev:docker

# 构建并启动带调试功能的 Docker 容器
npm run dev:docker:debug

# 或者直接使用 docker-compose
docker-compose up --build
```

访问 `http://localhost:8787` 查看应用运行状态。

#### Docker 环境变量

使用 Docker 运行时，需要设置以下环境变量：

- `CF_API_TOKEN`: Cloudflare API 令牌
- `CF_ACCOUNT_ID`: Cloudflare 账户 ID

可以通过创建 `.env` 文件来设置这些变量：

```env
CF_API_TOKEN=your_api_token_here
CF_ACCOUNT_ID=your_account_id_here
```

#### 系统兼容性说明

本项目使用 Ubuntu 22.04 作为 Docker 基础镜像，因为它包含运行 Cloudflare Workers 所需的 GLIBC 2.35+ 版本。早期的 Linux 发行版可能缺少此依赖，导致以下错误：

```
[ERROR] /workspace/node_modules/@cloudflare/workerd-linux-arm64/bin/workerd: /lib/aarch64-linux-gnu/libc.so.6: version `GLIBC_2.32' not found
```

#### 调试支持

Docker 环境支持通过 Node.js Inspector 进行调试：

1. 启动带调试功能的容器：
   ```bash
   npm run dev:docker:debug
   ```

2. 使用支持 Node.js 调试的 IDE（如 VS Code）连接到 `localhost:9229`

3. 在代码中设置断点并进行调试

注意：由于 Cloudflare Workers 的特殊运行环境，某些调试功能可能有限。

## 部署

```bash
npm run deploy
```

## 许可证

MIT