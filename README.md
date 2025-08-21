# 蓝奏云直链解析服务

这是一个用于解析蓝奏云分享链接并获取直链的 Cloudflare Worker 服务。

## 功能特性

- 解析蓝奏云分享链接获取直链
- 支持带密码和不带密码的文件
- 自动缓存解析结果，提高响应速度
- 自动刷新过期链接，保持链接有效性

## 使用方法

### 基本用法

- 无密码文件: `GET /:id`
- 有密码文件: `GET /:id/:pwd`

### 示例

- 无密码文件: `GET /iabc123d`
- 有密码文件: `GET /iabc123d/password123`

## API 端点

- `/` - 根路径，显示服务状态
- `/health` - 健康检查端点
- `/refresh` - 自动刷新端点（用于触发所有过期链接的刷新）

## 自动刷新机制

系统通过以下两种方式自动刷新链接：

1. 在处理请求时有5%的概率触发随机刷新检查
2. 通过 GitHub Actions 每10分钟调用一次 [/refresh](#/refresh) 端点

## GitHub Action 配置

要启用每10分钟自动刷新功能，需要在 GitHub 仓库中设置以下 secret：

- `REFRESH_URL`: 刷新接口的完整URL，例如 `https://your-worker.your-subdomain.workers.dev/refresh`

## 故障排除

如果 GitHub Action 执行失败，请检查以下几点：

1. 确保在 GitHub 仓库设置中正确设置了 `REFRESH_URL` secret
2. 手动访问刷新接口确认其正常工作：
   ```bash
   curl https://your-worker.your-subdomain.workers.dev/refresh
   ```
3. 检查 Cloudflare Worker 的日志以获取更多错误信息

## 部署

1. 克隆此仓库
2. 安装依赖: `npm install`
3. 配置 `wrangler.toml` 文件
4. 部署到 Cloudflare Workers: `npm run deploy`

## 许可证

MIT