import { getCacheData, setCacheData, deleteFromMemoryCache, cleanupMemoryCache, getRefreshPriority, setShardedBatchCacheData } from '../utils/cacheUtils.js';
import { refreshDownloadLink } from './downloadService.js';
import { ErrorType, analyzeError, getRetryConfig, calculateRetryDelay } from '../utils/errorUtils.js';

// 检查并刷新过期链接的任务函数
export async function checkAndRefreshLinks(env, priorityCacheKey = null) {
    // 这个函数将在后台运行，检查需要刷新的链接
    if (!env.DOWNLOAD_CACHE) return;

    try {
        const now = Date.now();

        // 如果指定了优先级缓存键，优先处理
        if (priorityCacheKey) {
            const cachedData = await getCacheData(priorityCacheKey, env);
            if (cachedData) {
                try {
                    // 提取id和pwd
                    const parts = priorityCacheKey.replace('download_', '').split('_');
                    const id = parts[0];
                    const pwd = parts[1] === 'nopwd' ? null : parts[1];

                    // 立即刷新链接
                    await refreshDownloadLink(priorityCacheKey, id, pwd, env);
                    return;
                } catch (e) {
                    console.error(`Error parsing cached data for ${priorityCacheKey}:`, e);
                    // 如果解析失败，删除损坏的缓存项
                    if (typeof env.DOWNLOAD_CACHE.delete === 'function') {
                        try {
                            await env.DOWNLOAD_CACHE.delete(priorityCacheKey);
                        } catch (deleteError) {
                            console.error(`Error deleting corrupted cache entry ${priorityCacheKey}:`, deleteError);
                        }
                    }
                    // 从内存缓存中删除
                    deleteFromMemoryCache(priorityCacheKey);
                }
            }
        }

        // 兼容 Cloudflare KV 和本地模拟的 KV
        let keys = { keys: [] };
        if (typeof env.DOWNLOAD_CACHE.list === 'function') {
            try {
                keys = await env.DOWNLOAD_CACHE.list();
            } catch (listError) {
                console.error('Error listing KV keys:', listError);
                return;
            }
        } else if (env.DOWNLOAD_CACHE.store) {
            // 本地模拟环境
            const keyArray = Array.from(env.DOWNLOAD_CACHE.store.keys())
                .filter(key => !key.endsWith('_time'))
                .map(key => ({ name: key }));
            keys = { keys: keyArray };
        }

        // 分类处理缓存项
        const urgentRefreshItems = [];  // 即将过期需要紧急刷新的项
        const normalRefreshItems = [];  // 正常刷新的项
        const expiredItems = [];        // 已过期的项
        const priorityItems = [];       // 智能优先级排序的项

        // 从环境变量读取配置参数
        const maxKeysToProcess = env?.MAX_KEYS_TO_PROCESS ? parseInt(env.MAX_KEYS_TO_PROCESS) : 100; // 恢复原来处理数量
        const urgentThreshold = env?.URGENT_THRESHOLD ? parseInt(env.URGENT_THRESHOLD) : (3 * 60 * 1000);
        
        let processedKeys = 0;

        // 批量获取缓存数据
        const batchSize = 20; // 增大批次大小
        const cacheDataMap = new Map();

        // 将所有需要处理的键分批获取
        for (let i = 0; i < keys.keys.length && processedKeys < maxKeysToProcess; i += batchSize) {
            const batchKeys = keys.keys.slice(i, i + batchSize).filter(key => !key.name.endsWith('_time'));
            const batchResults = await Promise.all(
                batchKeys.map(async (key) => {
                    try {
                        const cacheData = await getCacheData(key.name, env);
                        return { keyName: key.name, cacheData };
                    } catch (e) {
                        console.error(`Error fetching cache data for ${key.name}:`, e);
                        return { keyName: key.name, cacheData: null };
                    }
                })
            );

            for (const result of batchResults) {
                if (result.cacheData) {
                    cacheDataMap.set(result.keyName, result.cacheData);
                    processedKeys++;
                }
            }
        }

        // 处理每个缓存项并计算优先级
        for (const [cacheKey, cacheData] of cacheDataMap.entries()) {
            try {
                const timeData = cacheData._time;
                const refreshTime = timeData.refresh;

                // 检查是否是优先处理项
                if (priorityCacheKey && cacheKey === priorityCacheKey) {
                    // 已经优先处理过了，跳过
                    continue;
                }

                // 根据刷新时间分类
                if (now >= refreshTime || (now + urgentThreshold) >= (refreshTime + 15 * 60 * 1000)) {
                    // 需要刷新（当前时间超过刷新时间或即将过期）
                    if ((now + urgentThreshold) >= (refreshTime + 15 * 60 * 1000)) {
                        // 紧急刷新项（默认3分钟内即将过期）
                        urgentRefreshItems.push(cacheKey);
                    } else {
                        // 正常刷新项
                        normalRefreshItems.push(cacheKey);
                    }
                    
                    // 添加到优先级列表中
                    priorityItems.push({
                        key: cacheKey,
                        priority: getRefreshPriority(cacheKey, cacheData, env)
                    });
                }

                // 检查是否过期（基于刷新时间+15分钟）
                if (now >= (refreshTime + 15 * 60 * 1000)) {
                    expiredItems.push(cacheKey);
                }
            } catch (e) {
                console.error(`Error processing cache key ${cacheKey}:`, e);
                // 如果解析失败，尝试删除损坏的缓存项
                try {
                    if (typeof env.DOWNLOAD_CACHE.delete === 'function') {
                        await env.DOWNLOAD_CACHE.delete(cacheKey);
                        await env.DOWNLOAD_CACHE.delete(`${cacheKey}_time`);
                        console.log(`Deleted corrupted cache entry: ${cacheKey}`);
                    }
                    // 从内存缓存中删除
                    deleteFromMemoryCache(cacheKey);
                } catch (deleteError) {
                    console.error(`Error deleting corrupted cache entry ${cacheKey}:`, deleteError);
                }
            }
        }

        console.log(`Cache refresh statistics: ${urgentRefreshItems.length} urgent, ${normalRefreshItems.length} normal, ${expiredItems.length} expired`);

        // 按优先级排序
        priorityItems.sort((a, b) => b.priority - a.priority);
        console.log(`Top 5 priority items:`, priorityItems.slice(0, 5));

        // 批量处理过期项（删除）
        await batchDeleteCacheItems(expiredItems, env);
        console.log(`Expired cache entries deleted: ${expiredItems.length}`);

        // 恢复原来的刷新数量，确保所有需要刷新的链接都能及时更新
        const itemsToRefresh = priorityItems.slice(0, Math.min(maxKeysToProcess / 2, priorityItems.length)); // 刷新所有需要刷新的项
        
        // 收集需要刷新的数据
        const refreshedData = {};
        
        // 处理需要刷新的项
        for (const item of itemsToRefresh) {
            const cacheKey = item.key;
            try {
                const cachedData = await getCacheData(cacheKey, env);
                if (cachedData) {
                    // 不需要解析JSON，只需要知道缓存项存在
                    // 提取id和pwd
                    const parts = cacheKey.replace('download_', '').split('_');
                    const id = parts[0];
                    const pwd = parts[1] === 'nopwd' ? null : parts[1];

                    // 异步刷新链接，带重试机制
                    let retryCount = 0;
                    let success = false;
                    let retryErrorType = null;

                    while (retryCount <= BASE_RETRY_CONFIG.maxRetries && !success) {
                        try {
                            success = await refreshDownloadLink(cacheKey, id, pwd, env);
                            if (success) {
                                // 如果刷新成功，获取最新的数据
                                const updatedData = await getCacheData(cacheKey, env);
                                if (updatedData) {
                                    refreshedData[cacheKey] = updatedData;
                                }
                            }
                        } catch (e) {
                            retryCount++;
                            retryErrorType = analyzeError(e);
                            
                            if (retryCount <= BASE_RETRY_CONFIG.maxRetries) {
                                // 获取特定错误类型的重试配置
                                const retryConfig = getRetryConfig(retryErrorType, BASE_RETRY_CONFIG);
                                const delay = calculateRetryDelay(retryConfig, retryCount);
                                
                                console.log(`Retrying ${cacheKey} due to ${retryErrorType} (attempt ${retryCount}) after ${delay}ms...`);
                                await new Promise(resolve => setTimeout(resolve, delay));
                            } else {
                                console.error(`Failed to refresh item ${cacheKey} after ${BASE_RETRY_CONFIG.maxRetries} retries due to ${retryErrorType}`, e);
                            }
                        }
                    }
                    
                    if (success) {
                        console.log(`Successfully refreshed ${cacheKey} with priority ${item.priority}`);
                    } else if (retryErrorType) {
                        // 如果重试失败，记录错误类型
                        console.error(`Failed to refresh ${cacheKey} after ${BASE_RETRY_CONFIG.maxRetries} retries due to ${retryErrorType}`);
                    }
                }
            } catch (e) {
                console.error(`Error refreshing item ${cacheKey}:`, e);
            }
        }

        // 如果有刷新的数据，将它们分片存储到多个KV条目中
        if (Object.keys(refreshedData).length > 0) {
            try {
                await setShardedBatchCacheData(refreshedData, env);
            } catch (shardError) {
                console.error('Error storing sharded batch cache data:', shardError);
            }
        }

        // 清理内存缓存中的过期项
        const cleanedCount = cleanupMemoryCache();
        console.log(`Cleaned ${cleanedCount} expired items from memory cache`);

    } catch (error) {
        console.error('Error in checkAndRefreshLinks:', error);
    }
}

// 批量删除缓存项的函数
async function batchDeleteCacheItems(cacheKeys, env) {
    if (!env.DOWNLOAD_CACHE || !Array.isArray(cacheKeys) || cacheKeys.length === 0) return;
    
    // 从环境变量读取批处理大小，默认为10
    const batchSize = env?.BATCH_SIZE ? parseInt(env.BATCH_SIZE) : 10;
    
    // 分批执行删除操作
    for (let i = 0; i < cacheKeys.length; i += batchSize) {
        const batch = cacheKeys.slice(i, i + batchSize);
        
        // 并行处理每一批删除操作
        await Promise.all(batch.map(async (cacheKey) => {
            try {
                if (typeof env.DOWNLOAD_CACHE.delete === 'function') {
                    await env.DOWNLOAD_CACHE.delete(cacheKey);
                }
                // 从内存缓存中删除
                deleteFromMemoryCache(cacheKey);
                console.log(`Expired cache entry deleted: ${cacheKey}`);
            } catch (error) {
                console.error(`Error deleting cache entry ${cacheKey}:`, error);
            }
        }));
    }
}