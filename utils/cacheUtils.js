// utils/cacheUtils.js
import memoryCache from './memoryCache.js';

// 创建缓存实例
// 支持从环境变量读取配置参数，实现动态调整刷新策略
const CACHE_TTL = 15 * 60; // 15分钟缓存时间，与下载链接失效时间一致
const REFRESH_INTERVAL = 15 * 60 * 1000; // 15分钟刷新间隔（与 cron trigger 同步）
const URGENT_REFRESH_THRESHOLD = 3 * 60 * 1000; // 3分钟内即将过期的紧急刷新阈值
const MEMORY_CACHE_TTL = 5 * 60 * 1000; // 内存缓存5分钟过期时间

// 统一时间管理函数
export function getUnifiedTimeConfig(env) {
    // 从环境变量读取配置参数，实现动态调整刷新策略
    const refreshInterval = env?.REFRESH_INTERVAL ? parseInt(env.REFRESH_INTERVAL) : REFRESH_INTERVAL;
    const now = Date.now();
    return {
        now: now,
        refresh: now + refreshInterval
    };
}

// 合并数据存储函数 - 减少KV操作次数
export async function setCacheData(cacheKey, data, env) {
    if (env.DOWNLOAD_CACHE) {
        const timeConfig = getUnifiedTimeConfig(env);

        // 合并主数据和时间数据
        const cacheData = {
            ...data,
            _time: {
                refresh: timeConfig.refresh
            }
        };

        // 存储到内存缓存
        memoryCache.set(cacheKey, cacheData, MEMORY_CACHE_TTL);

        // 兼容 Cloudflare KV 和本地模拟的 KV
        if (typeof env.DOWNLOAD_CACHE.put === 'function') {
            // 将对象序列化为 JSON 字符串后再存储
            await env.DOWNLOAD_CACHE.put(cacheKey, JSON.stringify(cacheData));
        }
        return timeConfig;
    }
    return null;
}

// 检查是否需要刷新链接的函数 - 优化KV读取次数
export async function shouldRefreshLink(cacheKey, env) {
    if (!env.DOWNLOAD_CACHE) return false;

    try {
        // 兼容 Cloudflare KV 和本地模拟的 KV
        if (typeof env.DOWNLOAD_CACHE.get === 'function') {
            // 一次性读取所有需要的数据
            const cacheData = await getCacheData(cacheKey, env);
            if (!cacheData) {
                return true;
            }

            if (!cacheData._time) {
                // 如果没有时间数据，则需要刷新
                return true;
            }

            const timeData = cacheData._time;
            const now = Date.now();
            const refreshTime = timeData.refresh;
            
            // 从环境变量读取紧急刷新阈值
            const urgentThreshold = env?.URGENT_THRESHOLD ? parseInt(env.URGENT_THRESHOLD) : URGENT_REFRESH_THRESHOLD;

            // 两种情况需要刷新：
            // 1. 到了预定刷新时间
            // 2. 即将过期（默认3分钟内）
            return now >= refreshTime || (now + urgentThreshold) >= timeData.refresh;
        }
        return true;
    } catch (e) {
        console.error(`Error parsing cache data for ${cacheKey}:`, e);
        return true;
    }
}

// 检查链接是否过期的函数
export async function isLinkExpired(cacheKey, env) {
    if (!env.DOWNLOAD_CACHE) return true;

    try {
        // 兼容 Cloudflare KV 和本地模拟的 KV
        if (typeof env.DOWNLOAD_CACHE.get === 'function') {
            // 一次性读取所有需要的数据
            const cacheData = await getCacheData(cacheKey, env);
            if (!cacheData) {
                return true;
            }

            if (!cacheData._time) {
                // 如果没有时间数据，则认为已过期
                return true;
            }

            const timeData = cacheData._time;
            const now = Date.now();

            // 检查是否超过过期时间（使用刷新时间+15分钟作为过期时间）
            return now >= (timeData.refresh + 15 * 60 * 1000);
        }
        return true;
    } catch (e) {
        console.error(`Error parsing cache data for ${cacheKey}:`, e);
        return true;
    }
}

// 获取缓存数据的函数 - 减少重复的KV读取
export async function getCacheData(cacheKey, env) {
    if (!env.DOWNLOAD_CACHE) return null;

    try {
        // 首先尝试从内存缓存获取
        const memoryCachedData = memoryCache.get(cacheKey);
        if (memoryCachedData) {
            return memoryCachedData;
        }

        // 兼容 Cloudflare KV 和本地模拟的 KV
        if (typeof env.DOWNLOAD_CACHE.get === 'function') {
            const cacheData = await env.DOWNLOAD_CACHE.get(cacheKey);
            if (!cacheData) return null;

            // 如果返回的是字符串，尝试解析为 JSON
            let parsedData;
            if (typeof cacheData === 'string') {
                parsedData = JSON.parse(cacheData);
            } else {
                parsedData = cacheData;
            }

            // 存储到内存缓存
            memoryCache.set(cacheKey, parsedData, MEMORY_CACHE_TTL);
            
            return parsedData;
        }
        return null;
    } catch (e) {
        console.error(`Error parsing cache data for ${cacheKey}:`, e);
        return null;
    }
}

// 从内存缓存中删除数据
export function deleteFromMemoryCache(cacheKey) {
    return memoryCache.delete(cacheKey);
}

// 清理内存缓存中的过期项
export function cleanupMemoryCache() {
    return memoryCache.cleanup();
}