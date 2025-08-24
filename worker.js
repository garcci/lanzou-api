// worker.js
import { handleDownloadRequest } from './services/downloadService.js';
import { checkAndRefreshLinks } from './services/cacheRefreshService.js';
import memoryCache from './utils/memoryCache.js';
import requestCoalescer from './utils/requestCoalescer.js';

// 根路径路由 - 显示使用说明
function handleRootRequest() {
    const jsonData = {
        status: 'ok',
        timestamp: new Date().toISOString()
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
            message: 'Failed to execute refresh task',
            error: error.message,
            timestamp: new Date().toISOString()
        };

        return new Response(JSON.stringify(result), {
            status: 500,
            headers: { 'Content-Type': 'application/json;charset=utf-8' }
        });
    }
}

// 初始化D1数据库表
async function initializeD1Database(env) {
    if (!env.DB) return;
    
    try {
        // 创建缓存表
        await env.DB.prepare(`
            CREATE TABLE IF NOT EXISTS cache (
                cache_key TEXT PRIMARY KEY,
                data TEXT NOT NULL,
                created_at INTEGER NOT NULL DEFAULT (unixepoch()),
                updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
                expires_at INTEGER NOT NULL
            )
        `).run();
        
        // 创建索引
        await env.DB.prepare(`
            CREATE INDEX IF NOT EXISTS idx_cache_key ON cache(cache_key)
        `).run();
        
        await env.DB.prepare(`
            CREATE INDEX IF NOT EXISTS idx_expires_at ON cache(expires_at)
        `).run();
        
        console.log('D1 database initialized successfully');
    } catch (error) {
        console.error('Error initializing D1 database:', error);
    }
}

// 主处理函数
const worker = {
    async fetch(request, env, ctx) {
        try {
            // 初始化D1数据库
            if (env.DB) {
                await initializeD1Database(env);
            }
            
            const url = new URL(request.url);
            const path = url.pathname;
            const pathParts = path.split('/').filter(part => part !== '');
            const id = pathParts[0];
            const pwd = pathParts[1];

            // 根路径显示服务状态
            if (path === '/') {
                return new Response(JSON.stringify({
                    code: 200,
                    msg: '蓝奏云直链解析服务正在运行',
                    time: new Date().toISOString(),
                    memoryCacheSize: memoryCache.size(),
                    pendingRequests: requestCoalescer.getPendingRequestCount()
                }), {
                    headers: {'Content-Type': 'application/json;charset=UTF-8'}
                });
            }

            // 健康检查端点
            if (path === '/health') {
                return new Response(JSON.stringify({
                    status: 'healthy',
                    timestamp: Date.now(),
                    memoryCacheSize: memoryCache.size(),
                    pendingRequests: requestCoalescer.getPendingRequestCount()
                }), {
                    headers: {'Content-Type': 'application/json;charset=UTF-8'}
                });
            }

            // 刷新端点 - 用于触发所有过期链接的刷新
            if (path === '/refresh') {
                // 异步执行刷新任务
                if (ctx && ctx.waitUntil) {
                    ctx.waitUntil(checkAndRefreshLinks(env));
                }
                return new Response(JSON.stringify({
                    code: 200,
                    msg: '刷新任务已启动',
                    memoryCacheSize: memoryCache.size(),
                    pendingRequests: requestCoalescer.getPendingRequestCount()
                }), {
                    headers: {'Content-Type': 'application/json;charset=UTF-8'}
                });
            }

            // 处理下载请求
            if (id) {
                // 按需刷新缓存（降低触发概率）
                if (ctx && ctx.waitUntil && Math.random() < 0.05) {  // 5%的概率触发刷新
                    ctx.waitUntil(checkAndRefreshLinks(env));
                }

                return await handleDownloadRequest(id, pwd, env, request, ctx);
            }

            return new Response('Invalid request path', {status: 400});
        } catch (error) {
            console.error('Unhandled error in fetch handler:', error);
            return new Response(JSON.stringify({
                code: 500,
                msg: 'Internal server error',
                error: error.message
            }), {
                status: 500,
                headers: {'Content-Type': 'application/json;charset=UTF-8'}
            });
        }
    },

    // 添加 scheduled 事件处理器以支持 Cron Triggers
    async scheduled(controller, env, ctx) {
        console.log('Cron job triggered at:', new Date().toISOString());
        const startTime = Date.now();
        try {
            // 初始化D1数据库
            if (env.DB) {
                await initializeD1Database(env);
            }
            
            // 执行链接刷新任务
            await checkAndRefreshLinks(env);
            const duration = Date.now() - startTime;
            console.log(`Cron job completed successfully at: ${new Date().toISOString()}, duration: ${duration}ms, memoryCacheSize: ${memoryCache.size()}, pendingRequests: ${requestCoalescer.getPendingRequestCount()}`);
        } catch (error) {
            const duration = Date.now() - startTime;
            console.error(`Error in cron job at: ${new Date().toISOString()}, duration: ${duration}ms`, error);
        }
    }
};

export default worker;