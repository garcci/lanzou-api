# 蓝奏云直链解析服务

这是一个用于解析蓝奏云分享链接并获取直链的 Cloudflare Worker 服务。

## 功能特性

- 解析蓝奏云分享链接获取直链
- 支持带密码和不带密码的文件
- 自动缓存解析结果，提高响应速度
- 自动刷新过期链接，保持链接有效性
- 实时验证链接有效性，确保每时每刻请求到的下载链接都是有效的

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

1. 在处理请求时实时验证链接有效性，如果链接无效则立即刷新
2. 通过 GitHub Actions 每2分钟调用一次 [/refresh](#/refresh) 端点

## GitHub Action 配置

要启用每2分钟自动刷新功能，需要在 GitHub 仓库中设置以下 secret：

- `REFRESH_URL`: 刷新接口的完整URL，例如 `https://your-worker.your-subdomain.workers.dev/refresh`

配置步骤：
1. 转到 GitHub 仓库的 Settings 页面
2. 点击左侧的 "Secrets and variables" -> "Actions"
3. 点击 "New repository secret" 按钮
4. Name 设置为 `REFRESH_URL`
5. Value 设置为您的 Worker 刷新接口地址，例如 `https://lanzou-direct-link.your-subdomain.workers.dev/refresh`
6. 点击 "Add secret" 完成设置

## 故障排除

如果 GitHub Action 执行失败，请按以下步骤排查：

1. 确保在 GitHub 仓库设置中正确设置了 `REFRESH_URL` secret
   - 检查路径：Settings -> Secrets and variables -> Actions
   - 确保 secret 名称是 `REFRESH_URL`，值是正确的刷新接口地址

2. 手动访问刷新接口确认其正常工作：
   ```bash
   curl https://your-worker.your-subdomain.workers.dev/refresh
   ```

3. 检查 GitHub Actions 执行日志：
   - 转到仓库的 Actions 页面
   - 查看 "Refresh Download Links" 工作流的执行记录
   - 检查具体的错误信息

4. 检查 Cloudflare Worker 的日志以获取更多错误信息

5. 确保 Worker 正常运行且没有触发频率限制

常见问题及解决方案：

1. **GitHub Action 没有自动执行**
   - 确认您的仓库不是私有仓库（私有仓库可能需要额外配置）
   - 检查仓库中是否有最近的提交，GitHub Actions 通常在有提交时更容易触发
   - 可以通过手动触发工作流来测试是否正常工作
   - 我们已添加了一个备用的每5分钟执行一次的工作流作为冗余机制

2. **"REFRESH_URL secret is not set" 错误**
   - 按照上述步骤正确设置 secret

3. **请求超时或连接失败**
   - 检查 Worker URL 是否正确
   - 确保 Worker 正在运行
   - 检查防火墙或网络设置

4. **GitHub Actions 限制**
   - 免费账户的 GitHub Actions 有使用限制
   - 如果您的仓库使用超出了限制，可能会影响定时任务的执行
   - 可以通过升级到付费账户或减少执行频率来解决

## 部署

1. 克隆此仓库
2. 安装依赖: `npm install`
3. 配置 `wrangler.toml` 文件
4. 部署到 Cloudflare Workers: `npm run deploy`

## 许可证

MIT