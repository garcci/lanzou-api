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
    maxRetries: 2, // 减少重试次数以提高响应速度
    retryDelay: 200, // 减少重试延迟
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
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 减少超时时间到5秒

        const response = await fetch(url, {
            ...requestOptions,
            signal: controller.signal
        });

        clearTimeout(timeoutId);
        
        // 检查响应状态
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP ${response.status}: ${response.statusText}. Response: ${errorText.substring(0, 200)}`);
        }
        
        const responseText = await response.text();
        
        // 检查是否是HTML错误页面（仅对特定请求检查）
        if (url.includes('/ajaxm.php') && (responseText.trim().startsWith('<!DOCTYPE') || responseText.trim().startsWith('<html'))) {
            throw new Error(`Received HTML error page instead of JSON response. Response starts with: ${responseText.substring(0, 200)}`);
        }
        
        return new Response(responseText, response);
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
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 减少超时时间到5秒

        const response = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: new URLSearchParams(data).toString(),
            signal: controller.signal
        });

        clearTimeout(timeoutId);
        
        // 检查响应状态
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP ${response.status}: ${response.statusText}. Response: ${errorText.substring(0, 200)}`);
        }
        
        const responseText = await response.text();
        
        // 检查是否是HTML错误页面
        if (responseText.trim().startsWith('<!DOCTYPE') || responseText.trim().startsWith('<html')) {
            throw new Error(`Received HTML error page instead of JSON response. Response starts with: ${responseText.substring(0, 200)}`);
        }
        
        return responseText;
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
        
        // 检查是否是HTML错误页面
        if (htmlText.trim().startsWith('<!DOCTYPE') || htmlText.trim().startsWith('<html')) {
            // 检查是否包含错误信息
            if (htmlText.includes('502 Bad Gateway') || htmlText.includes('500 Internal Server Error')) {
                throw new Error(`Server error encountered: ${htmlText.substring(0, 200)}`);
            }
        }

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
                    
                    // 检查是否是HTML错误页面
                    if (fnContent.trim().startsWith('<!DOCTYPE') || fnContent.trim().startsWith('<html')) {
                        // 检查是否包含错误信息
                        if (fnContent.includes('502 Bad Gateway') || fnContent.includes('500 Internal Server Error')) {
                            throw new Error(`Server error encountered: ${fnContent.substring(0, 200)}`);
                        }
                    }

                    if (fnContent.includes('wp_sign') && fnContent.includes('/ajaxm.php?file=')) {
                        const fileMatchs = fnContent.match(/\/ajaxm\.php\?file=(\d+)/g);
                        if (!fileMatchs || fileMatchs.length < 2) {
                            throw new Error('File matches not found or insufficient matches');
                        }
                        const fileMatch = fileMatchs[1].match(/\/ajaxm\.php\?file=(\d+)/);
                        if (fileMatch && fileMatch[1]) {
                            const fileId = fileMatch[1];
                            // 添加安全检查，确保匹配存在
                            const wpSignMatch = fnContent.match(/wp_sign\s*=\s*'([^']+)'/);
                            const ajaxDataMatch = fnContent.match(/ajaxdata\s*=\s*'([^']+)'/);
                            
                            if (!wpSignMatch || !wpSignMatch[1]) {
                                throw new Error('wp_sign not found in fn content');
                            }
                            
                            if (!ajaxDataMatch || !ajaxDataMatch[1]) {
                                throw new Error('ajaxdata not found in fn content');
                            }
                            
                            const wp_sign = wpSignMatch[1];
                            const ajaxdata = ajaxDataMatch[1];
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
                            
                            // 增强错误处理
                            if (!result) {
                                throw new Error('Empty response from server');
                            }
                            
                            // 检查是否是HTML错误页面
                            if (result.trim().startsWith('<!DOCTYPE') || result.trim().startsWith('<html')) {
                                throw new Error(`Received HTML error page instead of JSON response. Response starts with: ${result.substring(0, 200)}`);
                            }
                            
                            let resultObj;
                            try {
                                resultObj = JSON.parse(result);
                            } catch (parseError) {
                                console.error('Failed to parse JSON response:', result);
                                throw new Error(`Invalid JSON response from server: ${result.substring(0, 100)}...`);
                            }

                            if (resultObj && resultObj.url) {
                                // 构造初始下载链接
                                const downloadUrl = resultObj.dom + "/file/" + resultObj.url;
                                // 立即跟踪重定向获取最终链接
                                const finalUrl = await followRedirect(downloadUrl);
                                return {
                                    redirect: finalUrl
                                };
                            } else {
                                console.error('Invalid response structure:', result);
                                throw new Error(`Invalid response structure from server: ${JSON.stringify(resultObj)}`);
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

// 跟踪重定向的函数（最多跟踪10次重定向）
async function followRedirect(url, maxRedirects = 10) {
    // 限制最大重定向次数以防止无限循环
    if (maxRedirects <= 0) {
        console.error('Max redirect limit reached for URL:', url);
        return url;
    }

    try {
        // 添加超时控制
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000); // 减少超时时间到3秒

        // 使用HEAD请求以减少数据传输
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

        // 如果不是重定向，返回最终URL
        return url;
    } catch (error) {
        console.error('Error following redirect for URL:', url, error);
        // 发生错误时返回最终解析得到的URL
        return url;
    }
}

// 检查URL是否有效的函数
async function checkUrlValidity(url) {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5秒超时

        const response = await fetch(url, {
            method: 'HEAD',
            headers: getCommonHeaders(),
            redirect: 'manual',
            signal: controller.signal
        });

        clearTimeout(timeoutId);
        
        // 如果状态码在200-399范围内，则认为URL有效
        return response.status >= 200 && response.status < 400;
    } catch (error) {
        console.error('Error checking URL validity:', url, error);
        return false;
    }
}

// 创建缓存实例
const CACHE_TTL = 15 * 60; // 15分钟缓存时间，与下载链接失效时间一致
const REFRESH_INTERVAL = 12 * 60 * 1000; // 12分钟刷新间隔，确保在失效前刷新
const EXPIRE_INTERVAL = 24 * 60 * 60 * 1000; // 24小时未访问则过期
const URGENT_REFRESH_THRESHOLD = 3 * 60 * 1000; // 3分钟内即将过期的紧急刷新阈值

// 统一时间管理函数
function getUnifiedTimeConfig() {
    const now = Date.now();
    return {
        now: now,
        refreshTime: now + REFRESH_INTERVAL,
        expireTime: now + EXPIRE_INTERVAL
    };
}

// 合并数据存储函数 - 减少KV操作次数
async function setCacheData(cacheKey, data, env) {
    if (env.DOWNLOAD_CACHE) {
        const timeConfig = getUnifiedTimeConfig();
        
        // 合并主数据和时间数据
        const cacheData = {
            ...data,
            _time: {
                access: timeConfig.now,
                refresh: timeConfig.refreshTime,
                expire: timeConfig.expireTime,
                updatedAt: timeConfig.now
            }
        };
        
        // 兼容 Cloudflare KV 和本地模拟的 KV
        if (typeof env.DOWNLOAD_CACHE.put === 'function') {
            // 将对象序列化为 JSON 字符串后再存储
            await env.DOWNLOAD_CACHE.put(cacheKey, JSON.stringify(cacheData));
        }
        return timeConfig;
    }
    return null;
}

// 更新访问时间的函数 - 简化数据结构以减少JSON操作
async function updateAccessTime(cacheKey, env) {
    if (env.DOWNLOAD_CACHE) {
        try {
            // 兼容 Cloudflare KV 和本地模拟的 KV
            if (typeof env.DOWNLOAD_CACHE.get === 'function' && typeof env.DOWNLOAD_CACHE.put === 'function') {
                // 一次性读取并更新数据
                const cacheDataStr = await env.DOWNLOAD_CACHE.get(cacheKey);
                if (cacheDataStr) {
                    try {
                        const cacheData = JSON.parse(cacheDataStr);
                        if (cacheData && cacheData._time) {
                            const now = Date.now();
                            // 更新访问时间
                            cacheData._time.access = now;
                            cacheData._time.updatedAt = now;
                            
                            // 一次性写入更新后的数据（序列化为 JSON 字符串）
                            await env.DOWNLOAD_CACHE.put(cacheKey, JSON.stringify(cacheData));
                        }
                    } catch (e) {
                        console.error(`Error updating access time for ${cacheKey}:`, e);
                    }
                }
            }
        } catch (e) {
            console.error(`Error updating access time for ${cacheKey}:`, e);
        }
    }
}

// 检查是否需要刷新链接的函数 - 优化KV读取次数
async function shouldRefreshLink(cacheKey, env) {
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
            const expireTime = timeData.expire;
            
            // 三种情况需要刷新：
            // 1. 到了预定刷新时间
            // 2. 即将过期（3分钟内）
            // 3. 已经过期
            return now >= refreshTime || (now + 3 * 60 * 1000) >= expireTime || now >= expireTime;
        }
        return true;
    } catch (e) {
        console.error(`Error parsing cache data for ${cacheKey}:`, e);
        return true;
    }
}

// 检查链接是否过期的函数
async function isLinkExpired(cacheKey, env) {
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
            const expireTime = timeData.expire;
            const accessTime = timeData.access;
            
            // 检查是否超过过期时间且24小时内未访问
            return now >= expireTime && (now - accessTime) >= EXPIRE_INTERVAL;
        }
        return true;
    } catch (e) {
        console.error(`Error parsing cache data for ${cacheKey}:`, e);
        return true;
    }
}

// 获取缓存数据的函数 - 减少重复的KV读取
async function getCacheData(cacheKey, env) {
    if (!env.DOWNLOAD_CACHE) return null;
    
    try {
        // 兼容 Cloudflare KV 和本地模拟的 KV
        if (typeof env.DOWNLOAD_CACHE.get === 'function') {
            const cacheData = await env.DOWNLOAD_CACHE.get(cacheKey);
            if (!cacheData) return null;
            
            // 如果返回的是字符串，尝试解析为 JSON
            if (typeof cacheData === 'string') {
                return JSON.parse(cacheData);
            }
            return cacheData;
        }
        return null;
    } catch (e) {
        console.error(`Error parsing cache data for ${cacheKey}:`, e);
        return null;
    }
}

// 创建统一的处理函数
async function handleDownloadRequest(id, pwd, env, request, ctx) {
    const startTime = Date.now();
    console.log(`Processing request for ID: ${id}, PWD: ${pwd}`);

    if (!id) {
        return new Response('Missing required parameter: id', {status: 400});
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
        try {
            // 检查是否需要刷新链接
            const needRefresh = await shouldRefreshLink(cacheKey, env);
            if (!needRefresh) {
                // 不需要刷新，直接返回缓存结果
                // 更新访问时间
                ctx.waitUntil(updateAccessTime(cacheKey, env));
                return cachedResponse;
            } else {
                console.log(`Link needs refresh for ${cacheKey}`);
                // 需要刷新，继续执行下面的逻辑
            }
        } catch (error) {
            console.error(`Error checking if link needs refresh for ${cacheKey}:`, error);
        }
    }

    // 然后尝试从KV存储中获取
    if (env.DOWNLOAD_CACHE) {
        const cachedData = await getCacheData(cacheKey, env);
        if (cachedData && cachedData.url) {
            try {
                // 检查是否需要刷新链接（即使在有效期内也检查链接是否仍然有效）
                const needRefresh = await shouldRefreshLink(cacheKey, env);
                const isUrlValid = await checkUrlValidity(cachedData.url);
                
                if (!needRefresh && isUrlValid) {
                    console.log(`KV cache hit for ${cacheKey}`);
                    // 更新访问时间
                    ctx.waitUntil(updateAccessTime(cacheKey, env));
                    // 更新Cloudflare缓存
                    const response = Response.redirect(cachedData.url, 302);
                    ctx.waitUntil(cache.put(cacheKeyRequest, response.clone()));
                    return response;
                } else if (!isUrlValid) {
                    console.log(`Cached URL is no longer valid for ${cacheKey}`);
                } else {
                    console.log(`Link needs refresh for ${cacheKey}`);
                }
            } catch (e) {
                console.error(`Error processing cached data for ${cacheKey}:`, e);
            }
        }
    }

    // 缓存未命中或需要刷新，获取新的下载链接
    try {
        const signAndFileId = await extractSignAndFileId(id);
        if (!signAndFileId) {
            return new Response('Sign value not found', {status: 404});
        }

        let downloadUrl;
        if (signAndFileId.redirect) {
            // 获取已经过重定向跟踪的最终链接
            const finalUrl = signAndFileId.redirect;
            downloadUrl = finalUrl;
        } else {
            const {fileId, sign} = signAndFileId;

            const postData = {
                action: "downprocess",
                sign: sign,
                kd: "1",
                p: pwd || ""
            };

            const response = await postRequest(`https://${LANZOU_DOMAIN}/ajaxm.php?file=${fileId}`, postData);
            
            // 增强错误处理
            if (!response) {
                throw new Error('Empty response from server');
            }
            
            let resultObj;
            try {
                resultObj = JSON.parse(response);
            } catch (parseError) {
                console.error('Failed to parse JSON response:', response);
                throw new Error(`Invalid JSON response from server: ${response.substring(0, 100)}...`);
            }

            if (resultObj && resultObj.url) {
                // 构造初始下载链接
                const url = resultObj.dom + "/file/" + resultObj.url;
                // 跟踪重定向并返回最终链接
                downloadUrl = await followRedirect(url);
            } else {
                console.error('Invalid response structure:', response);
                throw new Error(`Invalid response structure from server: ${JSON.stringify(resultObj)}`);
            }
        }

        // 确保我们获得了最终的下载链接
        if (downloadUrl) {
            const result = {
                url: downloadUrl, // 确保这是最终链接
                timestamp: Date.now(),
                id: id,
                pwd: pwd || null
            };

            // 将结果存入KV缓存
            if (env.DOWNLOAD_CACHE) {
                // 使用合并存储函数减少KV操作次数
                await setCacheData(cacheKey, result, env);
            }

            // 存储到Cloudflare缓存
            const response = Response.redirect(downloadUrl, 302);
            ctx.waitUntil(cache.put(cacheKeyRequest, response.clone()));

            console.log(`Request processed in ${Date.now() - startTime}ms`);

            return response;
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

// 获取初始响应的函数，用于优化初次请求速度
async function getInitialResponse(id, pwd, env) {
    // 这个函数可以用于在后台执行一些预处理任务
    // 当前为空实现，可根据需要扩展
    return null;
}

// 在后台解析最终URL并更新缓存的函数
async function resolveAndCacheFinalUrl(initialUrl, cacheKey, id, pwd, env, cacheKeyRequest, cache) {
    try {
        // 解析最终URL
        const finalUrl = await followRedirect(initialUrl);

        if (finalUrl !== initialUrl) {
            const result = {
                url: finalUrl, // 确保这是最终链接
                timestamp: Date.now(),
                id: id,
                pwd: pwd || null
            };

            // 更新KV缓存
            try {
                if (env && env.DOWNLOAD_CACHE) {
                    // 使用合并存储函数减少KV操作次数
                    await setCacheData(cacheKey, result, env);
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

// 定时刷新函数 - 添加重试机制
async function refreshDownloadLink(cacheKey, id, pwd, env, retryCount = 0) {
    console.log(`Refreshing download link for ${cacheKey} (attempt ${retryCount + 1})`);
    try {
        const signAndFileId = await extractSignAndFileId(id);
        if (!signAndFileId) {
            console.error(`Failed to refresh ${cacheKey}: Sign value not found`);
            // 添加重试机制
            if (retryCount < RETRY_CONFIG.maxRetries) {
                const delayTime = RETRY_CONFIG.exponentialBackoff
                    ? RETRY_CONFIG.retryDelay * Math.pow(2, retryCount)
                    : RETRY_CONFIG.retryDelay;
                
                await delay(delayTime);
                return refreshDownloadLink(cacheKey, id, pwd, env, retryCount + 1);
            }
            return false;
        }

        let downloadUrl;
        if (signAndFileId.redirect) {
            // 获取已经过重定向跟踪的最终链接
            const finalUrl = signAndFileId.redirect;
            downloadUrl = finalUrl;
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
                
                // 增强错误处理
                if (!response) {
                    throw new Error('Empty response from server');
                }
                
                let resultObj;
                try {
                    resultObj = JSON.parse(response);
                } catch (parseError) {
                    console.error(`Failed to parse JSON response for ${cacheKey}:`, response);
                    throw new Error(`Invalid JSON response from server: ${response.substring(0, 100)}...`);
                }

                if (resultObj && resultObj.url) {
                    // 构造初始下载链接
                    const url = resultObj.dom + "/file/" + resultObj.url;
                    // 跟踪重定向并返回最终链接
                    const resolvedUrl = await followRedirect(url);
                    downloadUrl = resolvedUrl;
                } else {
                    console.error(`Invalid response structure for ${cacheKey}:`, response);
                    // 添加重试机制
                    if (retryCount < RETRY_CONFIG.maxRetries) {
                        const delayTime = RETRY_CONFIG.exponentialBackoff
                            ? RETRY_CONFIG.retryDelay * Math.pow(2, retryCount)
                            : RETRY_CONFIG.retryDelay;
                        
                        await delay(delayTime);
                        return refreshDownloadLink(cacheKey, id, pwd, env, retryCount + 1);
                    }
                    return false;
                }
            } catch (parseError) {
                console.error(`Failed to parse response for ${cacheKey}:`, parseError);
                // 添加重试机制
                if (retryCount < RETRY_CONFIG.maxRetries) {
                    const delayTime = RETRY_CONFIG.exponentialBackoff
                        ? RETRY_CONFIG.retryDelay * Math.pow(2, retryCount)
                        : RETRY_CONFIG.retryDelay;
                    
                    await delay(delayTime);
                    return refreshDownloadLink(cacheKey, id, pwd, env, retryCount + 1);
                }
                return false;
            }
        }

        // 确保我们获得了最终的下载链接
        if (downloadUrl) {
            const result = {
                url: downloadUrl, // 确保这是最终链接
                timestamp: Date.now(),
                id: id,
                pwd: pwd || null
            };

            // 更新KV缓存
            if (env.DOWNLOAD_CACHE) {
                // 使用合并存储函数减少KV操作次数
                await setCacheData(cacheKey, result, env);
            }

            console.log(`Successfully refreshed download link for ${cacheKey}`);
            return true;
        } else {
            console.error(`Failed to get download URL for ${cacheKey}`);
            // 添加重试机制
            if (retryCount < RETRY_CONFIG.maxRetries) {
                const delayTime = RETRY_CONFIG.exponentialBackoff
                    ? RETRY_CONFIG.retryDelay * Math.pow(2, retryCount)
                    : RETRY_CONFIG.retryDelay;
                
                await delay(delayTime);
                return refreshDownloadLink(cacheKey, id, pwd, env, retryCount + 1);
            }
            return false;
        }
    } catch (error) {
        console.error(`Error refreshing download link for ${cacheKey}:`, error);
        // 出错时也更新刷新时间，避免持续尝试失败的刷新
        // 添加重试机制
        if (retryCount < RETRY_CONFIG.maxRetries) {
            const delayTime = RETRY_CONFIG.exponentialBackoff
                ? RETRY_CONFIG.retryDelay * Math.pow(2, retryCount)
                : RETRY_CONFIG.retryDelay;
            
            await delay(delayTime);
            return refreshDownloadLink(cacheKey, id, pwd, env, retryCount + 1);
        }
        
        try {
            if (env.DOWNLOAD_CACHE) {
                await updateAccessTime(cacheKey, env);
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
                const expireTime = timeData.expire;
                const accessTime = timeData.access;

                // 检查是否是优先处理项
                if (priorityCacheKey && cacheKey === priorityCacheKey) {
                    // 已经优先处理过了，跳过
                    continue;
                }

                // 根据刷新时间分类
                if (now >= refreshTime || (now + 3 * 60 * 1000) >= expireTime) {
                    // 需要刷新
                    if ((now + 3 * 60 * 1000) >= expireTime) {
                        // 紧急刷新项（3分钟内即将过期或已过期）
                        urgentRefreshItems.push(cacheKey);
                    } else {
                        // 正常刷新项
                        normalRefreshItems.push(cacheKey);
                    }
                }
                
                // 检查是否过期（24小时内未访问）
                if (now >= expireTime) {
                    // 如果24小时内没有访问过，则标记为过期项
                    if (now - accessTime >= EXPIRE_INTERVAL) {
                        expiredItems.push(cacheKey);
                    }
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
    console.log('Refresh request received');
    try {
        // 触发链接刷新
        await checkAndRefreshLinks(env);
        console.log('Refresh task completed successfully');
        
        const result = {
            status: 'success',
            message: 'Refresh task completed',
            timestamp: new Date().toISOString()
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

// 主处理函数
const worker = {
    async fetch(request, env, ctx) {
        try {
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
                    time: new Date().toISOString()
                }), {
                    headers: {'Content-Type': 'application/json;charset=UTF-8'}
                });
            }

            // 健康检查端点
            if (path === '/health') {
                return new Response(JSON.stringify({
                    status: 'healthy',
                    timestamp: Date.now()
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
                    msg: '刷新任务已启动'
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
    }
};

export default worker;
