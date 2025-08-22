// services/cacheRefreshService.js
import { getCacheData, setCacheData } from '../utils/cacheUtils.js';
import { refreshDownloadLink } from './downloadService.js';

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
                        await env.DOWNLOAD_CACHE.delete(priorityCacheKey);
                    }
                }
            }
        }

        // 兼容 Cloudflare KV 和本地模拟的 KV
        let keys = { keys: [] };
        if (typeof env.DOWNLOAD_CACHE.list === 'function') {
            keys = await env.DOWNLOAD_CACHE.list();
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

        // 限制处理的键数量以提高性能
        const maxKeysToProcess = 100; // 增加到100个键以确保更多链接得到处理
        let processedKeys = 0;

        // 批量获取缓存数据
        const batchSize = 20;
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

        // 处理每个缓存项
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
                if (now >= refreshTime || (now + 3 * 60 * 1000) >= (refreshTime + 15 * 60 * 1000)) {
                    // 需要刷新（当前时间超过刷新时间或即将过期）
                    if ((now + 3 * 60 * 1000) >= (refreshTime + 15 * 60 * 1000)) {
                        // 紧急刷新项（3分钟内即将过期）
                        urgentRefreshItems.push(cacheKey);
                    } else {
                        // 正常刷新项
                        normalRefreshItems.push(cacheKey);
                    }
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
                } catch (deleteError) {
                    console.error(`Error deleting corrupted cache entry ${cacheKey}:`, deleteError);
                }
            }
        }

        // 处理过期项（删除）
        for (const cacheKey of expiredItems) {
            if (typeof env.DOWNLOAD_CACHE.delete === 'function') {
                await env.DOWNLOAD_CACHE.delete(cacheKey); // 主缓存
            }
            console.log(`Expired cache entry deleted: ${cacheKey}`);
        }

        // 优先处理紧急刷新项
        for (const cacheKey of urgentRefreshItems) {
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
                    const maxRetries = 3;
                    let success = false;

                    while (retryCount <= maxRetries && !success) {
                        try {
                            success = await refreshDownloadLink(cacheKey, id, pwd, env);
                        } catch (e) {
                            retryCount++;
                            if (retryCount <= maxRetries) {
                                const delay = Math.pow(2, retryCount) * 100; // 指数退避
                                console.log(`Retrying ${cacheKey} (attempt ${retryCount}) after ${delay}ms...`);
                                await new Promise(resolve => setTimeout(resolve, delay));
                            } else {
                                console.error(`Failed to refresh urgent item ${cacheKey} after ${maxRetries} retries`, e);
                            }
                        }
                    }
                }
            } catch (e) {
                console.error(`Error refreshing urgent item ${cacheKey}:`, e);
            }
        }

        // 处理正常刷新项
        for (const cacheKey of normalRefreshItems) {
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
                    const maxRetries = 3;
                    let success = false;

                    while (retryCount <= maxRetries && !success) {
                        try {
                            success = await refreshDownloadLink(cacheKey, id, pwd, env);
                        } catch (e) {
                            retryCount++;
                            if (retryCount <= maxRetries) {
                                const delay = Math.pow(2, retryCount) * 100; // 指数退避
                                console.log(`Retrying ${cacheKey} (attempt ${retryCount}) after ${delay}ms...`);
                                await new Promise(resolve => setTimeout(resolve, delay));
                            } else {
                                console.error(`Failed to refresh normal item ${cacheKey} after ${maxRetries} retries`, e);
                            }
                        }
                    }
                }
            } catch (e) {
                console.error(`Error refreshing normal item ${cacheKey}:`, e);
            }
        }

    } catch (error) {
        console.error('Error in checkAndRefreshLinks:', error);
    }
}