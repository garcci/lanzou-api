// services/downloadService.js
import { extractSignAndFileId, followRedirect, checkUrlValidity } from '../utils/linkUtils.js';
import { postRequest } from '../utils/httpUtils.js';
import { getCacheData, setCacheData, shouldRefreshLink, deleteFromMemoryCache } from '../utils/cacheUtils.js';
import { getMimeTypeFromUrl, shouldDisplayInline } from '../utils/mimeUtils.js';
import requestCoalescer from '../utils/requestCoalescer.js';
import { ErrorType, analyzeError, getRetryConfig, calculateRetryDelay } from '../utils/errorUtils.js';

const LANZOU_DOMAIN = "lanzoux.com";

// 基础重试配置
const BASE_RETRY_CONFIG = {
    maxRetries: 2,
    retryDelay: 200,
    exponentialBackoff: true,
    jitter: true,
    maxDelay: 10000
};

// 创建统一的处理函数
export async function handleDownloadRequest(id, pwd, env, request, ctx) {
    const startTime = Date.now();
    console.log(`Processing request for ID: ${id}, PWD: ${pwd}`);

    if (!id) {
        return new Response('Missing required parameter: id', { status: 400 });
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
        // 检查是否需要刷新链接
        const needRefresh = await shouldRefreshLink(cacheKey, env);
        if (!needRefresh) {
            // 不需要刷新，直接返回缓存结果
            return cachedResponse;
        } else {
            console.log(`Link needs refresh for ${cacheKey}`);
            // 需要刷新，继续执行下面的逻辑
        }
    }

    // 然后尝试从内存缓存和KV存储中获取
    if (env.DOWNLOAD_CACHE) {
        const cachedData = await getCacheData(cacheKey, env);
        if (cachedData && cachedData.url) {
            try {
                // 检查是否需要刷新链接（即使在有效期内也检查链接是否仍然有效）
                const needRefresh = await shouldRefreshLink(cacheKey, env);
                const isUrlValid = await checkUrlValidity(cachedData.url);

                if (!needRefresh && isUrlValid) {
                    console.log(`Cache hit for ${cacheKey} (memory or KV)`);
                    // 更新Cloudflare缓存，设置较长的缓存时间
                    const mimeType = getMimeTypeFromUrl(cachedData.url);
                    const headers = {};
                    
                    if (mimeType) {
                        if (shouldDisplayInline(mimeType)) {
                            headers['Content-Disposition'] = 'inline';
                            headers['X-Display-Inline'] = 'true';
                        }
                        headers['Content-Type'] = mimeType;
                    }
                    
                    // 设置边缘缓存时间为2分钟，减少对源服务器的请求
                    headers['Cache-Control'] = 'public, max-age=120';
                    
                    const response = new Response(null, {
                        status: 302,
                        headers: {
                            ...headers,
                            'Location': cachedData.url
                        }
                    });
                    
                    ctx.waitUntil(cache.put(cacheKeyRequest, response.clone()));
                    return response;
                } else if (!isUrlValid) {
                    console.log(`Cached URL is no longer valid for ${cacheKey}`);
                    // 从内存缓存中删除无效数据
                    deleteFromMemoryCache(cacheKey);
                } else {
                    console.log(`Link needs refresh for ${cacheKey}`);
                }
            } catch (e) {
                console.error(`Error processing cached data for ${cacheKey}:`, e);
                // 即使检查失败，也优先返回缓存结果
                console.log(`Returning cached result despite check errors for ${cacheKey}`);
                const mimeType = getMimeTypeFromUrl(cachedData.url);
                const headers = {};
                
                if (mimeType) {
                    if (shouldDisplayInline(mimeType)) {
                        headers['Content-Disposition'] = 'inline';
                        headers['X-Display-Inline'] = 'true';
                    }
                    headers['Content-Type'] = mimeType;
                }
                
                // 设置边缘缓存时间为30秒，减少对源服务器的请求
                headers['Cache-Control'] = 'public, max-age=30';
                
                const response = new Response(null, {
                    status: 302,
                    headers: {
                        ...headers,
                        'Location': cachedData.url
                    }
                });
                
                ctx.waitUntil(cache.put(cacheKeyRequest, response.clone()));
                return response;
            }
        }
    }

    // 缓存未命中或需要刷新，获取新的下载链接
    // 使用请求合并管理器避免重复处理相同ID的请求
    try {
        const result = await requestCoalescer.addRequest(id, pwd, () => fetchNewDownloadLink(id, pwd, env, ctx));
        const downloadUrl = result.url;
        
        if (downloadUrl) {
            // 存储到Cloudflare缓存，设置合适的缓存时间
            const mimeType = getMimeTypeFromUrl(downloadUrl);
            const headers = {};
            
            if (mimeType) {
                if (shouldDisplayInline(mimeType)) {
                    headers['Content-Disposition'] = 'inline';
                    headers['X-Display-Inline'] = 'true';
                }
                headers['Content-Type'] = mimeType;
            }
            
            // 新获取的链接设置1分钟的边缘缓存时间
            headers['Cache-Control'] = 'public, max-age=60';
            
            const response = new Response(null, {
                status: 302,
                headers: {
                    ...headers,
                    'Location': downloadUrl
                }
            });
            
            ctx.waitUntil(cache.put(cacheKeyRequest, response.clone()));

            console.log(`Request processed in ${Date.now() - startTime}ms`);

            return response;
        }

        return new Response('Internal Server Error', { status: 500 });
    } catch (error) {
        console.error('Error processing request:', error);
        return new Response(JSON.stringify({
            error: 'Internal Server Error',
            message: error.message,
            time: Date.now() - startTime
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

// 获取新的下载链接的函数
async function fetchNewDownloadLink(id, pwd, env, ctx) {
    console.log(`Fetching new download link for ID: ${id}, PWD: ${pwd}`);
    
    const signAndFileId = await extractSignAndFileId(id);
    if (!signAndFileId) {
        throw new Error('Sign value not found');
    }

    let downloadUrl;
    if (signAndFileId.redirect) {
        // 获取已经过重定向跟踪的最终链接
        const finalUrl = signAndFileId.redirect;
        downloadUrl = finalUrl;
    } else {
        const { fileId, sign } = signAndFileId;

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

        // 将结果存入KV缓存、D1数据库和内存缓存
        if (env.DOWNLOAD_CACHE) {
            // 使用合并存储函数减少KV操作次数
            await setCacheData(`download_${id}_${pwd || 'nopwd'}`, result, env);
        }

        return result;
    } else {
        throw new Error('Failed to get download URL');
    }
}

// 定时刷新函数 - 添加重试机制
export async function refreshDownloadLink(cacheKey, id, pwd, env, retryCount = 0) {
    console.log(`Refreshing download link for ${cacheKey} (attempt ${retryCount + 1})`);
    try {
        const signAndFileId = await extractSignAndFileId(id);
        if (!signAndFileId) {
            console.error(`Failed to refresh ${cacheKey}: Sign value not found`);
            // 分析错误类型并获取相应的重试配置
            const error = new Error('Sign value not found');
            const errorType = analyzeError(error);
            const retryConfig = getRetryConfig(errorType, BASE_RETRY_CONFIG);
            
            // 添加重试机制
            if (retryCount < retryConfig.maxRetries) {
                const delayTime = calculateRetryDelay(retryConfig, retryCount);
                console.log(`Retrying due to ${errorType} (attempt ${retryCount + 1}/${retryConfig.maxRetries}), delay: ${delayTime}ms`);
                await new Promise(resolve => setTimeout(resolve, delayTime));
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
            const { fileId, sign } = signAndFileId;

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
                    // 分析错误类型并获取相应的重试配置
                    const error = new Error(`Invalid response structure: ${JSON.stringify(resultObj)}`);
                    const errorType = analyzeError(error);
                    const retryConfig = getRetryConfig(errorType, BASE_RETRY_CONFIG);
                    
                    // 添加重试机制
                    if (retryCount < retryConfig.maxRetries) {
                        const delayTime = calculateRetryDelay(retryConfig, retryCount);
                        console.log(`Retrying due to ${errorType} (attempt ${retryCount + 1}/${retryConfig.maxRetries}), delay: ${delayTime}ms`);
                        await new Promise(resolve => setTimeout(resolve, delayTime));
                        return refreshDownloadLink(cacheKey, id, pwd, env, retryCount + 1);
                    }
                    return false;
                }
            } catch (parseError) {
                console.error(`Failed to parse response for ${cacheKey}:`, parseError);
                // 分析错误类型并获取相应的重试配置
                const errorType = analyzeError(parseError);
                const retryConfig = getRetryConfig(errorType, BASE_RETRY_CONFIG);
                
                // 添加重试机制
                if (retryCount < retryConfig.maxRetries) {
                    const delayTime = calculateRetryDelay(retryConfig, retryCount);
                    console.log(`Retrying due to ${errorType} (attempt ${retryCount + 1}/${retryConfig.maxRetries}), delay: ${delayTime}ms`);
                    await new Promise(resolve => setTimeout(resolve, delayTime));
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

            // 更新KV缓存、D1数据库和内存缓存
            if (env.DOWNLOAD_CACHE) {
                // 使用合并存储函数减少KV操作次数
                try {
                    await setCacheData(cacheKey, result, env);
                } catch (error) {
                    console.error(`Error setting cache data for ${cacheKey}:`, error);
                    // 即使缓存写入失败，也认为刷新成功
                }
            }

            console.log(`Successfully refreshed download link for ${cacheKey}`);
            return true;
        } else {
            console.error(`Failed to get download URL for ${cacheKey}`);
            // 分析错误类型并获取相应的重试配置
            const error = new Error('Failed to get download URL');
            const errorType = analyzeError(error);
            const retryConfig = getRetryConfig(errorType, BASE_RETRY_CONFIG);
            
            // 添加重试机制
            if (retryCount < retryConfig.maxRetries) {
                const delayTime = calculateRetryDelay(retryConfig, retryCount);
                console.log(`Retrying due to ${errorType} (attempt ${retryCount + 1}/${retryConfig.maxRetries}), delay: ${delayTime}ms`);
                await new Promise(resolve => setTimeout(resolve, delayTime));
                return refreshDownloadLink(cacheKey, id, pwd, env, retryCount + 1);
            }
            return false;
        }
    } catch (error) {
        console.error(`Error refreshing download link for ${cacheKey}:`, error);
        // 出错时也更新刷新时间，避免持续尝试失败的刷新
        // 分析错误类型并获取相应的重试配置
        const errorType = analyzeError(error);
        const retryConfig = getRetryConfig(errorType, BASE_RETRY_CONFIG);
        
        // 添加重试机制
        if (retryCount < retryConfig.maxRetries) {
            const delayTime = calculateRetryDelay(retryConfig, retryCount);
            console.log(`Retrying due to ${errorType} (attempt ${retryCount + 1}/${retryConfig.maxRetries}), delay: ${delayTime}ms`);
            await new Promise(resolve => setTimeout(resolve, delayTime));
            return refreshDownloadLink(cacheKey, id, pwd, env, retryCount + 1);
        }

        return false;
    }
}