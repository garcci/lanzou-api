// worker.js
import { handleDownloadRequest } from './services/downloadService.js';
import { checkAndRefreshLinks } from './services/cacheRefreshService.js';
import memoryCache from './utils/memoryCache.js';
import requestCoalescer from './utils/requestCoalescer.js';

// 根路径路由 - 显示使用说明
function handleRootRequest() {
    const jsonData = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        endpoints: {
            download: '/:id/:pwd',
            health: '/health',
            refresh: '/refresh',
            admin: '/admin',
            view: '/view/:id/:pwd'
        }
    };
    return new Response(JSON.stringify(jsonData, null, 2), {
        headers: {'Content-Type': 'application/json;charset=utf-8'}
    });
}

// 健康检查端点
function handleHealthRequest() {
    const healthData = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        memoryCacheSize: memoryCache.size(),
        pendingRequests: requestCoalescer.getPendingRequestCount()
    };
    return new Response(JSON.stringify(healthData), {
        headers: { 'Content-Type': 'application/json;charset=utf-8' }
    });
}

// 自动刷新端点
async function handleRefreshRequest(env) {
    console.log('Refresh request received');
    try {
        // 触发链接刷新
        await checkAndRefreshLinks(env);
        console.log('Refresh task completed successfully');

        const result = {
            status: 'success',
            message: 'Refresh task completed',
            timestamp: new Date().toISOString(),
            memoryCacheSize: memoryCache.size()
        };

        return new Response(JSON.stringify(result), {
            headers: { 'Content-Type': 'application/json;charset=utf-8' }
        });
    } catch (error) {
        console.error('Error in refresh task:', error);
        const result = {
            status: 'error',
            message: 'Refresh task failed',
            error: error.message,
            timestamp: new Date().toISOString()
        };

        return new Response(JSON.stringify(result), {
            status: 500,
            headers: { 'Content-Type': 'application/json;charset=utf-8' }
        });
    }
}

// 管理页面端点
async function handleAdminRequest(request, env) {
    // 检查是否为 POST 请求，用于清除缓存
    if (request.method === 'POST') {
        const formData = await request.formData();
        const action = formData.get('action');
        
        if (action === 'clear-cache') {
            // 清除内存缓存
            memoryCache.clear();
            
            // 清除 D1 数据库缓存
            try {
                await env.DB.prepare('DELETE FROM cache').run();
            } catch (error) {
                console.error('Failed to clear D1 cache:', error);
            }
            
            // 清除 KV 缓存
            try {
                const keys = await env.DOWNLOAD_CACHE.list();
                for (const key of keys.keys) {
                    await env.DOWNLOAD_CACHE.delete(key.name);
                }
            } catch (error) {
                console.error('Failed to clear KV cache:', error);
            }
            
            return new Response('Cache cleared successfully', { 
                status: 200,
                headers: { 'Content-Type': 'text/plain' }
            });
        }
    }
    
    // 获取缓存统计信息
    let cacheStats = {
        memoryCacheSize: memoryCache.size(),
        d1CacheSize: 0,
        kvCacheSize: 0
    };
    
    try {
        const d1Result = await env.DB.prepare('SELECT COUNT(*) as count FROM cache').all();
        cacheStats.d1CacheSize = d1Result.results[0].count;
    } catch (error) {
        console.error('Failed to get D1 cache size:', error);
    }
    
    try {
        const kvResult = await env.DOWNLOAD_CACHE.list();
        cacheStats.kvCacheSize = kvResult.keys.length;
    } catch (error) {
        console.error('Failed to get KV cache size:', error);
    }
    
    // 生成管理页面HTML
    const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>蓝奏云直链解析服务管理面板</title>
    <style>
        :root {
            --primary-color: #4285f4;
            --success-color: #34a853;
            --warning-color: #fbbc05;
            --danger-color: #ea4335;
            --light-color: #f8f9fa;
            --dark-color: #343a40;
            --border-color: #dee2e6;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            margin: 0;
            padding: 0;
            background-color: #f5f7fa;
            color: #333;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
        }
        
        header {
            background: white;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            padding: 1rem;
            margin-bottom: 2rem;
        }
        
        h1 {
            margin: 0;
            color: var(--dark-color);
        }
        
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin-bottom: 2rem;
        }
        
        .stat-card {
            background: white;
            border-radius: 8px;
            padding: 1.5rem;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            text-align: center;
        }
        
        .stat-value {
            font-size: 2rem;
            font-weight: bold;
            margin: 0.5rem 0;
        }
        
        .stat-label {
            color: #6c757d;
            font-size: 0.9rem;
        }
        
        .cache-card {
            background: white;
            border-radius: 8px;
            padding: 1.5rem;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            margin-bottom: 2rem;
        }
        
        .cache-card h2 {
            margin-top: 0;
            color: var(--dark-color);
        }
        
        .btn {
            display: inline-block;
            padding: 0.5rem 1rem;
            border-radius: 4px;
            text-decoration: none;
            font-weight: 500;
            cursor: pointer;
            border: none;
            transition: all 0.2s;
        }
        
        .btn-primary {
            background-color: var(--primary-color);
            color: white;
        }
        
        .btn-danger {
            background-color: var(--danger-color);
            color: white;
        }
        
        .btn:hover {
            opacity: 0.9;
            transform: translateY(-2px);
        }
        
        .actions {
            display: flex;
            gap: 1rem;
            margin: 1rem 0;
        }
        
        footer {
            text-align: center;
            padding: 2rem;
            color: #6c757d;
            font-size: 0.9rem;
        }
        
        @media (max-width: 768px) {
            .container {
                padding: 10px;
            }
            
            .stats-grid {
                grid-template-columns: 1fr;
            }
            
            .actions {
                flex-direction: column;
            }
        }
    </style>
</head>
<body>
    <header>
        <div class="container">
            <h1>蓝奏云直链解析服务管理面板</h1>
        </div>
    </header>
    
    <div class="container">
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-value">${cacheStats.memoryCacheSize}</div>
                <div class="stat-label">内存缓存项数</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${cacheStats.d1CacheSize}</div>
                <div class="stat-label">D1数据库缓存项数</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${cacheStats.kvCacheSize}</div>
                <div class="stat-label">KV存储缓存项数</div>
            </div>
        </div>
        
        <div class="cache-card">
            <h2>缓存管理</h2>
            <p>使用以下按钮可以清除所有层级的缓存数据</p>
            <div class="actions">
                <form method="POST">
                    <input type="hidden" name="action" value="clear-cache">
                    <button type="submit" class="btn btn-danger" onclick="return confirm('确定要清除所有缓存吗？')">清除所有缓存</button>
                </form>
            </div>
        </div>
        
        <div class="cache-card">
            <h2>服务信息</h2>
            <p>蓝奏云直链解析服务运行在 Cloudflare Workers 上，使用多级缓存架构提升性能。</p>
            <ul>
                <li>内存缓存：提供最快的访问速度</li>
                <li>D1数据库：持久化存储，Worker重启后数据不丢失</li>
                <li>KV存储：分布式键值存储，提供高可用性</li>
            </ul>
        </div>
    </div>
    
    <footer>
        <div class="container">
            <p>蓝奏云直链解析服务 &copy; ${new Date().getFullYear()}</p>
        </div>
    </footer>
</body>
</html>
    `;
    
    return new Response(html, {
        headers: { 'Content-Type': 'text/html;charset=utf-8' }
    });
}

// 文件预览端点
async function handleViewRequest(id, pwd, env, request, ctx) {
    // 使用 handleDownloadRequest 获取文件信息
    const response = await handleDownloadRequest(id, pwd, env, request, ctx);
    
    // 如果是重定向响应，我们需要获取实际内容来显示
    if (response.status === 302) {
        const location = response.headers.get('Location');
        if (location) {
            try {
                // 获取实际文件内容
                const fileResponse = await fetch(location);
                if (fileResponse.ok) {
                    // 检查是否应该内联显示
                    const contentType = fileResponse.headers.get('Content-Type');
                    const contentDisposition = fileResponse.headers.get('Content-Disposition') || '';
                    
                    // 判断是否应该内联显示
                    const shouldInline = contentType && (
                        contentType.startsWith('image/') || 
                        contentType.startsWith('text/') ||
                        contentType.includes('pdf') ||
                        contentType.includes('json')
                    );
                    
                    // 构建响应
                    const headers = new Headers(fileResponse.headers);
                    if (shouldInline) {
                        headers.set('Content-Disposition', 'inline');
                    }
                    
                    return new Response(fileResponse.body, {
                        status: fileResponse.status,
                        headers: headers
                    });
                }
            } catch (error) {
                console.error('Error fetching file for view:', error);
            }
        }
    }
    
    // 如果无法内联显示，返回原始响应
    return response;
}

// 使用 HTMLRewriter 解析请求体中的 HTML 内容
async function parseHtmlContent(request) {
    const contentType = request.headers.get('Content-Type');
    if (!contentType || !contentType.includes('text/html')) {
        return null;
    }
    
    const body = await request.text();
    
    // 使用 HTMLRewriter 提取信息
    let title = '';
    let links = [];
    
    class TitleExtractor {
        text(text) {
            if (!text.removed) {
                title = text.text.trim();
            }
        }
    }
    
    class LinkExtractor {
        element(element) {
            const href = element.getAttribute('href');
            const text = element.text;
            if (href) {
                links.push({ href, text });
            }
        }
    }
    
    const rewriter = new HTMLRewriter()
        .on('title', new TitleExtractor())
        .on('a[href]', new LinkExtractor());
    
    // 创建一个临时响应来处理 HTML
    const tempResponse = new Response(body);
    await rewriter.transform(tempResponse).text(); // 触发处理
    
    return { title, links };
}

// 处理 HTML 内容分析请求
async function handleHtmlAnalysisRequest(request) {
    try {
        const result = await parseHtmlContent(request);
        if (!result) {
            return new Response(JSON.stringify({ error: '无效的HTML内容' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }
        
        return new Response(JSON.stringify(result, null, 2), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const path = url.pathname;
        
        // 初始化数据库
        try {
            await env.DB.exec(`
                CREATE TABLE IF NOT EXISTS cache (
                    cache_key TEXT PRIMARY KEY,
                    data TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    expires_at TIMESTAMP,
                    access_count INTEGER DEFAULT 0
                );
            `);
        } catch (error) {
            console.error('Database initialization error:', error);
        }
        
        // 路由处理
        if (path === '/') {
            return handleRootRequest();
        }
        
        if (path === '/health') {
            return handleHealthRequest();
        }
        
        if (path === '/refresh') {
            return await handleRefreshRequest(env);
        }
        
        if (path === '/admin') {
            return await handleAdminRequest(request, env);
        }
        
        // HTML 内容分析端点
        if (path === '/analyze-html' && request.method === 'POST') {
            return await handleHtmlAnalysisRequest(request);
        }
        
        // 文件预览端点
        const viewMatch = path.match(/^\/view\/([^/]+)(?:\/(.*))?/);
        if (viewMatch) {
            const [, id, pwd = ''] = viewMatch;
            return await handleViewRequest(id, pwd, env, request, ctx);
        }
        
        // 下载请求处理
        const downloadMatch = path.match(/^\/([^/]+)(?:\/(.*))?/);
        if (downloadMatch) {
            const [, id, pwd = ''] = downloadMatch;
            return await handleDownloadRequest(id, pwd, env, request, ctx);
        }
        
        return new Response('Not Found', { status: 404 });
    },
    
    async scheduled(controller, env, ctx) {
        console.log('Scheduled task triggered');
        try {
            // 初始化数据库
            try {
                const createTableQuery = `
                    CREATE TABLE IF NOT EXISTS cache (
                        cache_key TEXT PRIMARY KEY,
                        data TEXT NOT NULL,
                        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
                        expires_at TEXT,
                        access_count INTEGER DEFAULT 0
                    );
                `;
                await env.DB.exec(createTableQuery);
            } catch (error) {
                console.error('Database initialization error:', error);
            }
            
            // 执行定期任务
            await checkAndRefreshLinks(env);
        } catch (error) {
            console.error('Scheduled task error:', error);
        }
    }
};