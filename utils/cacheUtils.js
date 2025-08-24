// utils/cacheUtils.js
import memoryCache from './memoryCache.js';
import { getMimeTypeFromUrl } from './mimeUtils.js';

// 创建缓存实例
// 支持从环境变量读取配置参数，实现动态调整刷新策略
const CACHE_TTL = 15 * 60; // 15分钟缓存时间，与下载链接失效时间一致
const REFRESH_INTERVAL = 15 * 60 * 1000; // 15分钟刷新间隔（与 cron trigger 同步）
const URGENT_REFRESH_THRESHOLD = 3 * 60 * 1000; // 3分钟内即将过期的紧急刷新阈值
const MEMORY_CACHE_TTL = 5 * 60 * 1000; // 内存缓存5分钟过期时间

// 判断文件类型是否值得缓存
function isCacheableFileType(url) {
    const cacheableExtensions = [
        '.jpg', '.jpeg', '.png', '.gif', '.webp', '.ico',  // 图片
        '.mp4', '.webm', '.mov', '.avi', '.mkv',          // 视频
        '.mp3', '.wav', '.ogg', '.m4a'                    // 音频
    ];
    
    if (!url) return false;
    
    const lowerUrl = url.toLowerCase();
    return cacheableExtensions.some(ext => lowerUrl.endsWith(ext));
}

// 获取缓存项的访问频率分数
function getAccessFrequencyScore(cacheData) {
    // 简化的访问频率计算，实际项目中可以基于历史访问数据计算
    // 这里我们基于缓存数据的存在时间和类型来估算
    if (!cacheData || !cacheData.timestamp) return 0;
    
    const ageInMinutes = (Date.now() - cacheData.timestamp) / (60 * 1000);
    // 较新的项获得更高的分数
    return Math.max(0, 100 - ageInMinutes);
}

// 确定缓存项的刷新优先级
export function getRefreshPriority(cacheKey, cacheData, env) {
    if (!cacheData) return 0;
    
    let priority = 0;
    
    // 1. 根据文件类型确定基础优先级
    const mimeType = getMimeTypeFromUrl(cacheData.url);
    const isImage = mimeType && mimeType.startsWith('image/');
    const isMedia = mimeType && (mimeType.startsWith('video/') || mimeType.startsWith('audio/'));
    const isCacheableFile = isCacheableFileType(cacheData.url);
    
    if (isImage) priority += 30;
    else if (isMedia) priority += 20;
    else if (isCacheableFile) priority += 10;
    
    // 2. 根据访问频率调整优先级
    const frequencyScore = getAccessFrequencyScore(cacheData);
    priority += Math.min(frequencyScore, 50); // 最多增加50分
    
    // 3. 根据时间因素调整优先级
    const now = Date.now();
    const timeToExpiry = (cacheData._time?.refresh || now) + (15 * 60 * 1000) - now;
    
    // 即将过期的项优先级更高
    if (timeToExpiry < 5 * 60 * 1000) { // 5分钟内过期
        priority += 40;
    } else if (timeToExpiry < 10 * 60 * 1000) { // 10分钟内过期
        priority += 20;
    }
    
    // 4. 从环境变量获取自定义权重
    const customWeight = env?.PRIORITY_WEIGHTS?.[cacheKey];
    if (customWeight) {
        priority += parseInt(customWeight) || 0;
    }
    
    return priority;
}

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

// 批量存储数据到KV的函数 - 显著减少KV操作次数
export async function batchSetCacheData(cacheDataMap, env) {
    if (!env.DOWNLOAD_CACHE) return;
    
    // 从环境变量读取批处理大小，默认为10
    const batchSize = env?.BATCH_SIZE ? parseInt(env.BATCH_SIZE) : 10;
    
    // 将所有数据分批处理
    const entries = Array.from(cacheDataMap.entries());
    
    // 分批执行存储操作
    for (let i = 0; i < entries.length; i += batchSize) {
        const batch = entries.slice(i, i + batchSize);
        
        // 并行处理每一批数据
        await Promise.all(batch.map(async ([cacheKey, data]) => {
            try {
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
                
                // 存储到KV
                if (typeof env.DOWNLOAD_CACHE.put === 'function') {
                    await env.DOWNLOAD_CACHE.put(cacheKey, JSON.stringify(cacheData));
                }
            } catch (error) {
                console.error(`Error storing cache data for ${cacheKey}:`, error);
            }
        }));
    }
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