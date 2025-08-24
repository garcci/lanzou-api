// utils/cacheUtils.js
import memoryCache from './memoryCache.js';
import { getMimeTypeFromUrl } from './mimeUtils.js';

// 创建缓存实例
// 支持从环境变量读取配置参数，实现动态调整刷新策略
const CACHE_TTL = 15 * 60; // 15分钟缓存时间，与下载链接失效时间一致
const REFRESH_INTERVAL = 15 * 60 * 1000; // 15分钟刷新间隔（与 cron trigger 同步）
const URGENT_REFRESH_THRESHOLD = 3 * 60 * 1000; // 3分钟内即将过期的紧急刷新阈值
const MEMORY_CACHE_TTL = 5 * 60 * 1000; // 内存缓存5分钟过期时间
const WRITE_THROTTLE_INTERVAL = 24 * 60 * 60 * 1000 / 500; // 控制每天最多500次写入操作
const BATCH_CACHE_KEY_PREFIX = '__batch_cache_data_'; // 批量缓存数据的键前缀
const BATCH_CACHE_KEY_SUFFIX = '__'; // 批量缓存数据的键后缀
const BATCH_CACHE_METADATA_KEY = '__batch_cache_metadata__'; // 批量缓存元数据键
const KV_SIZE_LIMIT = 25 * 1024 * 1024; // KV大小限制 25MB

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
            // 检查是否允许写入（控制写入频率）
            const lastWriteTime = await getLastWriteTime(env);
            const now = Date.now();
            
            // 如果距离上次写入时间足够长，或者这是高优先级的写入操作，则执行写入
            if ((now - lastWriteTime) >= WRITE_THROTTLE_INTERVAL || 
                (data && data.url && isCacheableFileType(data.url))) {
                // 将对象序列化为 JSON 字符串后再存储
                await env.DOWNLOAD_CACHE.put(cacheKey, JSON.stringify(cacheData));
                // 更新最后一次写入时间
                await updateLastWriteTime(env, now);
            } else {
                console.log(`Skipping KV write for ${cacheKey} due to throttling`);
            }
        }
        return timeConfig;
    }
    return null;
}

// 获取最后一次写入时间
async function getLastWriteTime(env) {
    if (typeof env.DOWNLOAD_CACHE.get === 'function') {
        const lastWriteTimeStr = await env.DOWNLOAD_CACHE.get('__last_write_time__');
        return lastWriteTimeStr ? parseInt(lastWriteTimeStr) : 0;
    }
    return 0;
}

// 更新最后一次写入时间
async function updateLastWriteTime(env, timestamp) {
    if (typeof env.DOWNLOAD_CACHE.put === 'function') {
        await env.DOWNLOAD_CACHE.put('__last_write_time__', timestamp.toString());
    }
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
                    // 检查是否允许写入（控制写入频率）
                    const lastWriteTime = await getLastWriteTime(env);
                    const now = Date.now();
                    
                    // 如果距离上次写入时间足够长，或者这是高优先级的写入操作，则执行写入
                    if ((now - lastWriteTime) >= WRITE_THROTTLE_INTERVAL || 
                        (data && data.url && isCacheableFileType(data.url))) {
                        await env.DOWNLOAD_CACHE.put(cacheKey, JSON.stringify(cacheData));
                        // 更新最后一次写入时间
                        await updateLastWriteTime(env, now);
                    } else {
                        console.log(`Skipping KV write for ${cacheKey} due to throttling`);
                    }
                }
            } catch (error) {
                console.error(`Error storing cache data for ${cacheKey}:`, error);
            }
        }));
    }
}

// 将所有缓存数据分片存储到多个KV条目中
export async function setShardedBatchCacheData(batchData, env) {
    if (!env.DOWNLOAD_CACHE) return;
    
    try {
        // 检查是否允许写入（控制写入频率）
        const lastWriteTime = await getLastWriteTime(env);
        const now = Date.now();
        
        // 如果距离上次写入时间足够长，则执行写入
        if ((now - lastWriteTime) >= WRITE_THROTTLE_INTERVAL) {
            // 准备分片数据
            const shards = {};
            let currentShardIndex = 0;
            let currentShardSize = 0;
            let currentShard = {};
            
            // 添加元数据信息
            const metadata = {
                updatedAt: now,
                shardCount: 0,
                shards: []
            };
            
            // 遍历所有数据并分片
            for (const [key, value] of Object.entries(batchData)) {
                const item = { [key]: value };
                const itemSize = JSON.stringify(item).length;
                
                // 如果当前分片加上新项会超过大小限制，或者分片已经有500个项，则创建新分片
                if (currentShardSize + itemSize > KV_SIZE_LIMIT || Object.keys(currentShard).length >= 500) {
                    // 保存当前分片
                    shards[currentShardIndex] = currentShard;
                    metadata.shards.push(currentShardIndex);
                    
                    // 创建新分片
                    currentShardIndex++;
                    currentShard = item;
                    currentShardSize = itemSize;
                } else {
                    // 添加到当前分片
                    currentShard[key] = value;
                    currentShardSize += itemSize;
                }
            }
            
            // 保存最后一个分片
            if (Object.keys(currentShard).length > 0) {
                shards[currentShardIndex] = currentShard;
                metadata.shards.push(currentShardIndex);
            }
            
            metadata.shardCount = Object.keys(shards).length;
            
            // 存储所有分片
            const shardKeys = Object.keys(shards);
            for (const shardIndex of shardKeys) {
                const shardData = shards[shardIndex];
                const shardKey = `${BATCH_CACHE_KEY_PREFIX}${shardIndex}${BATCH_CACHE_KEY_SUFFIX}`;
                const serializedShardData = JSON.stringify(shardData);
                
                await env.DOWNLOAD_CACHE.put(shardKey, serializedShardData);
                console.log(`Stored shard ${shardIndex} with ${Object.keys(shardData).length} entries`);
            }
            
            // 存储元数据
            await env.DOWNLOAD_CACHE.put(BATCH_CACHE_METADATA_KEY, JSON.stringify(metadata));
            
            // 更新最后一次写入时间
            await updateLastWriteTime(env, now);
            console.log(`Batch cache data updated with ${Object.keys(batchData).length} entries across ${shardKeys.length} shards`);
        } else {
            console.log('Skipping batch cache update due to throttling');
        }
    } catch (error) {
        console.error('Error setting sharded batch cache data:', error);
    }
}

// 从分片的KV条目中获取特定缓存数据
export async function getShardedBatchCacheData(cacheKey, env) {
    if (!env.DOWNLOAD_CACHE) return null;
    
    try {
        // 首先尝试从内存缓存获取
        const memoryCachedData = memoryCache.get(cacheKey);
        if (memoryCachedData) {
            return memoryCachedData;
        }
        
        // 从元数据获取分片信息
        const metadataStr = await env.DOWNLOAD_CACHE.get(BATCH_CACHE_METADATA_KEY);
        if (!metadataStr) return null;
        
        const metadata = JSON.parse(metadataStr);
        if (!metadata.shards || metadata.shards.length === 0) return null;
        
        // 遍历所有分片查找数据
        for (const shardIndex of metadata.shards) {
            const shardKey = `${BATCH_CACHE_KEY_PREFIX}${shardIndex}${BATCH_CACHE_KEY_SUFFIX}`;
            const shardDataStr = await env.DOWNLOAD_CACHE.get(shardKey);
            
            if (shardDataStr) {
                const shardData = JSON.parse(shardDataStr);
                const cacheData = shardData[cacheKey];
                
                if (cacheData) {
                    // 存储到内存缓存
                    memoryCache.set(cacheKey, cacheData, MEMORY_CACHE_TTL);
                    return cacheData;
                }
            }
        }
        
        return null;
    } catch (error) {
        console.error(`Error getting sharded batch cache data for ${cacheKey}:`, error);
        return null;
    }
}

// 检查是否需要刷新链接的函数 - 优化KV读取次数
export async function shouldRefreshLink(cacheKey, env) {
    if (!env.DOWNLOAD_CACHE) return false;

    try {
        // 兼容 Cloudflare KV 和本地模拟的 KV
        if (typeof env.DOWNLOAD_CACHE.get === 'function') {
            // 优先从分片批量缓存数据中获取
            let cacheData = await getShardedBatchCacheData(cacheKey, env);
            
            // 如果分片批量缓存中没有，则从单独的键中获取
            if (!cacheData) {
                cacheData = await getCacheData(cacheKey, env);
            }
            
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
            // 优先从分片批量缓存数据中获取
            let cacheData = await getShardedBatchCacheData(cacheKey, env);
            
            // 如果分片批量缓存中没有，则从单独的键中获取
            if (!cacheData) {
                cacheData = await getCacheData(cacheKey, env);
            }
            
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