// worker.js
const LANZOU_DOMAIN = "lanzoux.com";

// 统一的请求头
function getCommonHeaders() {
    return {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Referer': `https://${LANZOU_DOMAIN}`,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Pragma': 'no-cache',
        'Upgrade-Insecure-Requests': '1',
        'Cookie': "down_ip=1; expires=Sat, 16-Nov-2090 11:42:54 GMT; path=/; domain=.baidupan.com"
    };
}

function randIP() {
    function r() {
        return Math.round(Math.random() * (2550000 - 600000) + 600000) % 256
    }

    const ip2id = r();
    const ip3id = r();
    const ip4id = r();
    const arr_1 = ["218", "218", "66", "66", "218", "218", "60", "60", "202", "204", "66", "66", "66", "59", "61", "60", "222", "221", "66", "59", "60", "60", "66", "218", "218", "62", "63", "64", "66", "66", "122", "211"];
    const randIndex = Math.floor(Math.random() * arr_1.length);
    const ip1id = arr_1[randIndex];
    return `${ip1id}.${ip2id}.${ip3id}.${ip4id}`;
}

// 增加重试次数和延迟以提高稳定性
const RETRY_CONFIG = {
    maxRetries: 3, // 减少重试次数以避免超时
    retryDelay: 300,
    exponentialBackoff: true
};

// 延迟函数
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// GET请求函数（带重试机制）
async function getRequest(url, retryCount = 0, options = {}) {
    const headers = {
        ...getCommonHeaders(),
        'X-Forwarded-For': randIP(),
        'CLIENT-IP': randIP()
    };

    const requestOptions = {
        method: 'GET',
        headers: headers,
        ...options
    };

    try {
        // 添加超时控制
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10秒超时

        const response = await fetch(url, {
            ...requestOptions,
            signal: controller.signal
        });

        clearTimeout(timeoutId);
        return response;
    } catch (error) {
        console.error(`Error in GET request (attempt ${retryCount + 1}):`, error.message);

        if (retryCount < RETRY_CONFIG.maxRetries) {
            const delayTime = RETRY_CONFIG.exponentialBackoff
                ? RETRY_CONFIG.retryDelay * Math.pow(2, retryCount)
                : RETRY_CONFIG.retryDelay;

            await delay(delayTime);
            return getRequest(url, retryCount + 1, options);
        }

        throw error;
    }
}

// POST请求函数（带重试机制）
async function postRequest(url, data, retryCount = 0) {
    const headers = {
        ...getCommonHeaders(),
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Forwarded-For': randIP(),
        'CLIENT-IP': randIP()
    };

    try {
        // 添加超时控制
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10秒超时

        const response = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: new URLSearchParams(data).toString(),
            signal: controller.signal
        });

        clearTimeout(timeoutId);
        return await response.text();
    } catch (error) {
        console.error(`Error in POST request (attempt ${retryCount + 1}):`, error.message);

        if (retryCount < RETRY_CONFIG.maxRetries) {
            const delayTime = RETRY_CONFIG.exponentialBackoff
                ? RETRY_CONFIG.retryDelay * Math.pow(2, retryCount)
                : RETRY_CONFIG.retryDelay;

            await delay(delayTime);
            return postRequest(url, data, retryCount + 1);
        }

        throw error;
    }
}

// 提取signValue的函数（带重试机制）
async function extractSignAndFileId(fileId, retryCount = 0) {
    try {
        const response = await getRequest(`https://${LANZOU_DOMAIN}/${fileId}`);
        const htmlText = await response.text();

        if (htmlText.includes('sign') && htmlText.includes('/ajaxm.php?file=')) {
            const signMatches = htmlText.match(/'sign':'([^']+)'/g);
            if (!signMatches || signMatches.length < 2) {
                throw new Error('Sign matches not found or insufficient matches');
            }
            const signMatch = signMatches[1].match(/'sign':'([^']+)'/);
            const fileMatch = htmlText.match(/\/ajaxm\.php\?file=(\d+)/);
            if (signMatch && signMatch[1] && fileMatch && fileMatch[1]) {
                return {
                    fileId: fileMatch[1],
                    sign: signMatch[1],
                };
            }
        }

        if (htmlText.includes('src="/fn?')) {
            const fnMatch = htmlText.match(/src="\/fn\?([^"]+)"/);
            if (fnMatch && fnMatch[1]) {
                const fn = fnMatch[1];
                try {
                    const fnResponse = await getRequest(`https://${LANZOU_DOMAIN}/fn?${fn}`);
                    const fnContent = await fnResponse.text();

                    if (fnContent.includes('wp_sign') && fnContent.includes('/ajaxm.php?file=')) {
                        const fileMatchs = fnContent.match(/\/ajaxm\.php\?file=(\d+)/g);
                        if (!fileMatchs || fileMatchs.length < 2) {
                            throw new Error('File matches not found or insufficient matches');
                        }
                        const fileMatch = fileMatchs[1].match(/\/ajaxm\.php\?file=(\d+)/);
                        if (fileMatch && fileMatch[1]) {
                            const fileId = fileMatch[1];
                            const wp_sign = fnContent.match(/wp_sign\s*=\s*'([^']+)'/)[1];
                            const ajaxdata = fnContent.match(/ajaxdata\s*=\s*'([^']+)'/)[1];
                            const postData = {
                                action: "downprocess",
                                websignkey: ajaxdata,
                                signs: ajaxdata,
                                sign: wp_sign,
                                websign: "",
                                kd: "1",
                                ves: "1"
                            };
                            const result = await postRequest(`https://${LANZOU_DOMAIN}/ajaxm.php?file=${fileId}`, postData);
                            const resultObj = JSON.parse(result);

                            if (resultObj && resultObj.url) {
                                const downloadUrl = resultObj.dom + "/file/" + resultObj.url;
                                return {
                                    redirect: downloadUrl
                                };
                            }
                        }
                    }
                } catch (error) {
                    console.error('Error in GET request:', error);
                    throw error;
                }
            }
        }
        throw new Error('Sign and file ID not found');
    } catch (error) {
        console.error(`Error extracting sign and file ID (attempt ${retryCount + 1}):`, error.message);

        if (retryCount < RETRY_CONFIG.maxRetries) {
            const delayTime = RETRY_CONFIG.exponentialBackoff
                ? RETRY_CONFIG.retryDelay * Math.pow(2, retryCount)
                : RETRY_CONFIG.retryDelay;

            await delay(delayTime);
            return extractSignAndFileId(fileId, retryCount + 1);
        }

        throw error;
    }
}

// 跟踪重定向地址的函数 - 优化递归处理
async function followRedirect(url, maxRedirects = 5) { // 减少最大重定向次数
    if (maxRedirects <= 0) {
        console.warn('Max redirect limit reached for URL:', url);
        return url;
    }

    try {
        // 使用HEAD请求以减少数据传输
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5秒超时

        const response = await fetch(url, {
            method: 'HEAD',
            headers: getCommonHeaders(),
            redirect: 'manual',
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        // 检查是否是重定向状态码
        if (response.status === 301 || response.status === 302 || response.status === 307 || response.status === 308) {
            const location = response.headers.get('location');
            if (location) {
                // 处理相对路径
                const absoluteUrl = new URL(location, url).href;
                console.log(`Redirecting from ${url} to ${absoluteUrl}`);
                // 递归跟踪重定向
                return await followRedirect(absoluteUrl, maxRedirects - 1);
            }
        }

        // 如果不是重定向，返回当前URL
        return url;
    } catch (error) {
        console.error('Error following redirect for URL:', url, error);
        // 发生错误时返回原始URL
        return url;
    }
}

// 创建缓存实例
const CACHE_TTL = 15 * 60; // 15分钟缓存时间
const REFRESH_INTERVAL = 10 * 60 * 1000; // 10分钟刷新间隔
const EXPIRE_INTERVAL = 24 * 60 * 60 * 1000; // 24小时未访问则过期
const URGENT_REFRESH_THRESHOLD = 2 * 60 * 1000; // 2分钟内即将过期的紧急刷新阈值

// 更新访问时间的函数
async function updateAccessTime(cacheKey, env) {
    if (env.DOWNLOAD_CACHE) {
        // 更新访问时间
        await env.DOWNLOAD_CACHE.put(`${cacheKey}_access`, Date.now().toString(), {expirationTtl: CACHE_TTL});

        // 更新过期时间
        const expireTime = Date.now() + EXPIRE_INTERVAL;
        await env.DOWNLOAD_CACHE.put(`${cacheKey}_expire`, expireTime.toString(), {expirationTtl: CACHE_TTL + 60 * 60});
    }
}

// 创建统一的处理函数
async function handleDownloadRequest(id, pwd, env, request, ctx) {
    const startTime = Date.now();
    console.log(`Processing request for ID: ${id}, PWD: ${pwd}`);

    if (!id) {
        return new Response('Missing required parameter: id', {status: 0});
    }

    // 尝试从缓存中获取结果
    const cacheKey = `download_${id}_${pwd || 'nopwd'}`;

    // 首先尝试从Cloudflare缓存中获取
    const cache = caches.default;
    const cacheUrl = new URL(request.url);
    const cacheKeyRequest = new Request(cacheUrl.toString(), request);
    const cachedResponse = await cache.match(cacheKeyRequest);

    if (cachedResponse) {
        console.log(`Cloudflare cache hit for ${cacheKey}`);
        // 更新访问时间
        ctx.waitUntil(updateAccessTime(cacheKey, env));
        return cachedResponse;
    }

    // 然后尝试从KV存储中获取
    if (env.DOWNLOAD_CACHE) {
        const cachedResult = await env.DOWNLOAD_CACHE.get(cacheKey, {type: 'json'});
        if (cachedResult && (Date.now() - cachedResult.timestamp) < (CACHE_TTL * 1000)) {
            console.log(`KV cache hit for ${cacheKey}`);
            // 更新访问时间
            ctx.waitUntil(updateAccessTime(cacheKey, env));
            // 更新Cloudflare缓存
            const response = Response.redirect(cachedResult.url, 302);
            ctx.waitUntil(cache.put(cacheKeyRequest, response.clone()));
            return response;
        }
    }

    try {
        const signAndFileId = await extractSignAndFileId(id);
        if (!signAndFileId) {
            return new Response('Sign value not found', {status: 404});
        }

        let downloadUrl;
        let initialUrl; // 用于存储初始URL
        if (signAndFileId.redirect) {
            // 获取原始链接
            const originalUrl = signAndFileId.redirect;
            initialUrl = originalUrl;
            // 直接跟踪重定向并返回最终链接
            const resolvedUrl = await followRedirect(originalUrl);
            downloadUrl = resolvedUrl;
        } else {
            const {fileId, sign} = signAndFileId;

            const postData = {
                action: "downprocess",
                sign: sign,
                kd: "1",
                p: pwd || ""
            };

            const response = await postRequest(`https://${LANZOU_DOMAIN}/ajaxm.php?file=${fileId}`, postData);
            const resultObj = JSON.parse(response);

            if (resultObj && resultObj.url) {
                const url = resultObj.dom + "/file/" + resultObj.url;
                initialUrl = url; // 保存初始URL
                // 跟踪重定向并返回最终链接
                const resolvedUrl = await followRedirect(url);
                downloadUrl = resolvedUrl;
            }
        }

        if (downloadUrl && initialUrl) {
            const result = {
                url: downloadUrl,
                timestamp: Date.now(),
                id: id,
                pwd: pwd || null
            };

            // 将结果存入KV缓存
            if (env.DOWNLOAD_CACHE) {
                await env.DOWNLOAD_CACHE.put(cacheKey, JSON.stringify(result), {expirationTtl: CACHE_TTL});

                // 设置定时刷新任务
                const refreshTime = Date.now() + REFRESH_INTERVAL;
                await env.DOWNLOAD_CACHE.put(`${cacheKey}_refresh`, refreshTime.toString(), {expirationTtl: CACHE_TTL});

                // 设置访问时间，用于过期检查
                await updateAccessTime(cacheKey, env);
            }

            // 存储到Cloudflare缓存
            const response = Response.redirect(downloadUrl, 302);
            ctx.waitUntil(cache.put(cacheKeyRequest, response.clone()));

            console.log(`Request processed in ${Date.now() - startTime}ms`);

            // 立即返回初始URL，同时在后台解析最终URL并更新缓存
            const initialResponse = Response.redirect(initialUrl, 302);
            ctx.waitUntil(resolveAndCacheFinalUrl(initialUrl, cacheKey, id, pwd, env, cacheKeyRequest, cache));
            return initialResponse;
        }

        return new Response('Internal Server Error', {status: 500});
    } catch (error) {
        console.error('Error processing request:', error);
        return new Response(JSON.stringify({
            error: 'Internal Server Error',
            message: error.message,
            time: Date.now() - startTime
        }), {
            status: 500,
            headers: {'Content-Type': 'application/json'}
        });
    }
}

// 在后台解析最终URL并更新缓存的函数
async function resolveAndCacheFinalUrl(initialUrl, cacheKey, id, pwd, env, cacheKeyRequest, cache) {
    try {
        // 解析最终URL
        const finalUrl = await followRedirect(initialUrl);

        if (finalUrl !== initialUrl) {
            const result = {
                url: finalUrl,
                timestamp: Date.now(),
                id: id,
                pwd: pwd || null
            };

            // 更新KV缓存
            try {
                if (env && env.DOWNLOAD_CACHE) {
                    await env.DOWNLOAD_CACHE.put(cacheKey, JSON.stringify(result), {expirationTtl: CACHE_TTL});

                    // 设置定时刷新任务
                    const refreshTime = Date.now() + REFRESH_INTERVAL;
                    await env.DOWNLOAD_CACHE.put(`${cacheKey}_refresh`, refreshTime.toString(), {expirationTtl: CACHE_TTL});

                    // 设置访问时间，用于过期检查
                    await updateAccessTime(cacheKey, env);
                }

                // 更新Cloudflare缓存
                if (cache && cacheKeyRequest) {
                    const response = Response.redirect(finalUrl, 302);
                    await cache.put(cacheKeyRequest, response.clone());
                }

                console.log(`Background update completed for ${cacheKey}`);
            } catch (storageError) {
                console.error(`Error storing final URL in cache for ${cacheKey}:`, storageError);
            }
        } else {
            console.log(`No change in URL for ${cacheKey}, skipping cache update`);
        }
    } catch (error) {
        console.error(`Error resolving final URL for ${cacheKey}:`, error);
        // 即使解析失败，也更新访问时间以避免被过早清理
        try {
            if (env && env.DOWNLOAD_CACHE) {
                await updateAccessTime(cacheKey, env);
            }
        } catch (updateError) {
            console.error(`Error updating access time for ${cacheKey}:`, updateError);
        }
    }
}

// 定时刷新函数
async function refreshDownloadLink(cacheKey, id, pwd, env) {
    console.log(`Refreshing download link for ${cacheKey}`);
    try {
        const signAndFileId = await extractSignAndFileId(id);
        if (!signAndFileId) {
            console.error(`Failed to refresh ${cacheKey}: Sign value not found`);
            return false;
        }

        let downloadUrl;
        if (signAndFileId.redirect) {
            // 获取原始链接
            const originalUrl = signAndFileId.redirect;
            // 直接跟踪重定向并返回最终链接
            const resolvedUrl = await followRedirect(originalUrl);
            downloadUrl = resolvedUrl;
        } else {
            const {fileId, sign} = signAndFileId;

            const postData = {
                action: "downprocess",
                sign: sign,
                kd: "1",
                p: pwd || ""
            };

            try {
                const response = await postRequest(`https://${LANZOU_DOMAIN}/ajaxm.php?file=${fileId}`, postData);
                const resultObj = JSON.parse(response);

                if (resultObj && resultObj.url) {
                    const url = resultObj.dom + "/file/" + resultObj.url;
                    // 跟踪重定向并返回最终链接
                    const resolvedUrl = await followRedirect(url);
                    downloadUrl = resolvedUrl;
                } else {
                    console.error(`Invalid response structure for ${cacheKey}:`, resultObj);
                    return false;
                }
            } catch (parseError) {
                console.error(`Failed to parse response for ${cacheKey}:`, parseError);
                return false;
            }
        }

        if (downloadUrl) {
            const result = {
                url: downloadUrl,
                timestamp: Date.now(),
                id: id,
                pwd: pwd || null
            };

            // 更新KV缓存
            if (env.DOWNLOAD_CACHE) {
                await env.DOWNLOAD_CACHE.put(cacheKey, JSON.stringify(result), {expirationTtl: CACHE_TTL});

                // 设置下一次刷新时间
                const refreshTime = Date.now() + REFRESH_INTERVAL;
                await env.DOWNLOAD_CACHE.put(`${cacheKey}_refresh`, refreshTime.toString(), {expirationTtl: CACHE_TTL});

                // 更新访问时间
                await updateAccessTime(cacheKey, env);
            }

            console.log(`Successfully refreshed download link for ${cacheKey}`);
            return true;
        } else {
            console.error(`Failed to get download URL for ${cacheKey}`);
            return false;
        }
    } catch (error) {
        console.error(`Error refreshing download link for ${cacheKey}:`, error);
        // 出错时也更新刷新时间，避免持续尝试失败的刷新
        try {
            if (env.DOWNLOAD_CACHE) {
                const refreshTime = Date.now() + REFRESH_INTERVAL;
                await env.DOWNLOAD_CACHE.put(`${cacheKey}_refresh`, refreshTime.toString(), {expirationTtl: CACHE_TTL});
            }
        } catch (updateError) {
            console.error(`Error updating refresh time for ${cacheKey}:`, updateError);
        }
        return false;
    }
}

// 检查并刷新过期链接的任务函数
async function checkAndRefreshLinks(env, priorityCacheKey = null) {
    // 这个函数将在后台运行，检查需要刷新的链接
    if (!env.DOWNLOAD_CACHE) return;

    try {
        const now = Date.now();

        // 如果指定了优先级缓存键，优先处理
        if (priorityCacheKey) {
            const cachedDataStr = await env.DOWNLOAD_CACHE.get(priorityCacheKey);
            if (cachedDataStr) {
                try {
                    const cachedData = JSON.parse(cachedDataStr);
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
                    await env.DOWNLOAD_CACHE.delete(priorityCacheKey);
                    await env.DOWNLOAD_CACHE.delete(`${priorityCacheKey}_refresh`);
                }
            }
        }

        // 获取所有缓存键
        const keys = await env.DOWNLOAD_CACHE.list();

        // 分类处理缓存项
        const urgentRefreshItems = [];  // 即将过期需要紧急刷新的项
        const normalRefreshItems = [];  // 正常刷新的项
        const expiredItems = [];        // 已过期的项

        // 限制处理的键数量以提高性能
        const maxKeysToProcess = 50; // 增加到50个键
        let processedKeys = 0;

        for (const key of keys.keys) {
            // 限制处理的键数量
            if (processedKeys >= maxKeysToProcess) {
                break;
            }

            if (key.name.endsWith('_refresh')) {
                try {
                    const refreshTimeStr = await env.DOWNLOAD_CACHE.get(key.name);
                    if (refreshTimeStr) {
                        const refreshTime = parseInt(refreshTimeStr);
                        const cacheKey = key.name.replace('_refresh', '');

                        // 检查是否是优先处理项
                        if (priorityCacheKey && cacheKey === priorityCacheKey) {
                            // 已经优先处理过了，跳过
                            continue;
                        }

                        // 根据刷新时间分类
                        if (now >= refreshTime) {
                            // 需要刷新
                            if (now - refreshTime < URGENT_REFRESH_THRESHOLD) {
                                // 紧急刷新项（已过期但时间不长）
                                urgentRefreshItems.push(cacheKey);
                            } else {
                                // 正常刷新项
                                normalRefreshItems.push(cacheKey);
                            }
                            processedKeys++;
                        }
                    }
                } catch (e) {
                    console.error(`Error processing refresh key ${key.name}:`, e);
                }
            }

            // 检查是否有过期的缓存项（24小时内未访问）
            if (key.name.endsWith('_expire')) {
                try {
                    const expireTimeStr = await env.DOWNLOAD_CACHE.get(key.name);
                    const cacheKey = key.name.replace('_expire', '');
                    if (expireTimeStr) {
                        const expireTime = parseInt(expireTimeStr);
                        if (now >= expireTime) {
                            // 检查最近访问时间
                            const accessTimeStr = await env.DOWNLOAD_CACHE.get(`${cacheKey}_access`);
                            if (accessTimeStr) {
                                const accessTime = parseInt(accessTimeStr);
                                // 如果24小时内没有访问过，则标记为过期项
                                if (now - accessTime >= EXPIRE_INTERVAL) {
                                    expiredItems.push(cacheKey);
                                }
                            } else {
                                // 没有访问时间记录，标记为过期项
                                expiredItems.push(cacheKey);
                            }
                        }
                    }
                } catch (e) {
                    console.error(`Error processing expire key ${key.name}:`, e);
                }
            }
        }

        // 处理过期项（删除）
        for (const cacheKey of expiredItems) {
            await env.DOWNLOAD_CACHE.delete(cacheKey); // 主缓存
            await env.DOWNLOAD_CACHE.delete(`${cacheKey}_refresh`); // 刷新时间
            await env.DOWNLOAD_CACHE.delete(`${cacheKey}_access`); // 访问时间
            await env.DOWNLOAD_CACHE.delete(`${cacheKey}_expire`); // 过期时间
            console.log(`Expired cache entry deleted: ${cacheKey}`);
        }

        // 优先处理紧急刷新项
        for (const cacheKey of urgentRefreshItems) {
            try {
                const cachedDataStr = await env.DOWNLOAD_CACHE.get(cacheKey);
                if (cachedDataStr) {
                    const cachedData = JSON.parse(cachedDataStr);
                    // 提取id和pwd
                    const parts = cacheKey.replace('download_', '').split('_');
                    const id = parts[0];
                    const pwd = parts[1] === 'nopwd' ? null : parts[1];

                    // 异步刷新链接
                    await refreshDownloadLink(cacheKey, id, pwd, env);
                }
            } catch (e) {
                console.error(`Error refreshing urgent item ${cacheKey}:`, e);
            }
        }

        // 处理正常刷新项
        for (const cacheKey of normalRefreshItems) {
            try {
                const cachedDataStr = await env.DOWNLOAD_CACHE.get(cacheKey);
                if (cachedDataStr) {
                    const cachedData = JSON.parse(cachedDataStr);
                    // 提取id和pwd
                    const parts = cacheKey.replace('download_', '').split('_');
                    const id = parts[0];
                    const pwd = parts[1] === 'nopwd' ? null : parts[1];

                    // 异步刷新链接
                    await refreshDownloadLink(cacheKey, id, pwd, env);
                }
            } catch (e) {
                console.error(`Error refreshing normal item ${cacheKey}:`, e);
            }
        }

    } catch (error) {
        console.error('Error in checkAndRefreshLinks:', error);
    }
}

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
        timestamp: new Date().toISOString()
    };
    return new Response(JSON.stringify(healthData), {
        headers: { 'Content-Type': 'application/json;charset=utf-8' }
    });
}

// 自动刷新端点
async function handleRefreshRequest(env) {
    try {
        // 触发链接刷新
        const refreshResult = await checkAndRefreshLinks(env);
        
        const result = {
            status: 'success',
            message: 'Refresh task completed',
            timestamp: new Date().toISOString()
        };
        
        return new Response(JSON.stringify(result), {
            headers: { 'Content-Type': 'application/json;charset=utf-8' }
        });
    } catch (error) {
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

// 主处理函数
export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const path = url.pathname;

        // 处理根路径
        if (path === '/') {
            return handleRootRequest();
        }

        // 处理健康检查
        if (path === '/health') {
            return handleHealthRequest();
        }

        // 处理自动刷新请求
        if (path === '/refresh') {
            return await handleRefreshRequest(env);
        }

        // 检查是否需要刷新链接（降低触发概率并增加智能判断）
        // 只有在非GET请求或者有特定查询参数时才触发检查
        const shouldCheckRefresh = Math.random() < 0.05; // 降低到5%的概率
        if (shouldCheckRefresh) {
            ctx.waitUntil(checkAndRefreshLinks(env));
        }

        // 处理下载请求
        const pathParts = path.split('/').filter(part => part !== '');
        if (pathParts.length === 1) {
            // 无密码文件: /:id
            const id = pathParts[0];
            return await handleDownloadRequest(id, null, env, request, ctx);
        } else if (pathParts.length === 2) {
            // 有密码文件: /:id/:pwd
            const id = pathParts[0];
            const pwd = pathParts[1];
            return await handleDownloadRequest(id, pwd, env, request, ctx);
        }

        return new Response('Not Found', { status: 404 });
    }
};
