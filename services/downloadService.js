// services/downloadService.js
import { extractSignAndFileId, followRedirect, checkUrlValidity } from '../utils/linkUtils.js';
import { postRequest } from '../utils/httpUtils.js';
import { getCacheData, setCacheData, shouldRefreshLink, deleteFromMemoryCache } from '../utils/cacheUtils.js';

const LANZOU_DOMAIN = "lanzoux.com";

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
                    // 更新Cloudflare缓存
                    const response = Response.redirect(cachedData.url, 302);
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
                const response = Response.redirect(cachedData.url, 302);
                ctx.waitUntil(cache.put(cacheKeyRequest, response.clone()));
                return response;
            }
        }
    }

    // 缓存未命中或需要刷新，获取新的下载链接
    try {
        const signAndFileId = await extractSignAndFileId(id);
        if (!signAndFileId) {
            return new Response('Sign value not found', { status: 404 });
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

            // 将结果存入KV缓存和内存缓存
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

// 定时刷新函数 - 添加重试机制
export async function refreshDownloadLink(cacheKey, id, pwd, env, retryCount = 0) {
    console.log(`Refreshing download link for ${cacheKey} (attempt ${retryCount + 1})`);
    try {
        const signAndFileId = await extractSignAndFileId(id);
        if (!signAndFileId) {
            console.error(`Failed to refresh ${cacheKey}: Sign value not found`);
            // 添加重试机制
            if (retryCount < 2) {
                const delayTime = true
                    ? 200 * Math.pow(2, retryCount)
                    : 200;

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
                    // 添加重试机制
                    if (retryCount < 2) {
                        const delayTime = true
                            ? 200 * Math.pow(2, retryCount)
                            : 200;

                        await new Promise(resolve => setTimeout(resolve, delayTime));
                        return refreshDownloadLink(cacheKey, id, pwd, env, retryCount + 1);
                    }
                    return false;
                }
            } catch (parseError) {
                console.error(`Failed to parse response for ${cacheKey}:`, parseError);
                // 添加重试机制
                if (retryCount < 2) {
                    const delayTime = true
                        ? 200 * Math.pow(2, retryCount)
                        : 200;

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

            // 更新KV缓存和内存缓存
            if (env.DOWNLOAD_CACHE) {
                // 使用合并存储函数减少KV操作次数
                await setCacheData(cacheKey, result, env);
            }

            console.log(`Successfully refreshed download link for ${cacheKey}`);
            return true;
        } else {
            console.error(`Failed to get download URL for ${cacheKey}`);
            // 添加重试机制
            if (retryCount < 2) {
                const delayTime = true
                    ? 200 * Math.pow(2, retryCount)
                    : 200;

                await new Promise(resolve => setTimeout(resolve, delayTime));
                return refreshDownloadLink(cacheKey, id, pwd, env, retryCount + 1);
            }
            return false;
        }
    } catch (error) {
        console.error(`Error refreshing download link for ${cacheKey}:`, error);
        // 出错时也更新刷新时间，避免持续尝试失败的刷新
        // 添加重试机制
        if (retryCount < 2) {
            const delayTime = true
                ? 200 * Math.pow(2, retryCount)
                : 200;

            await new Promise(resolve => setTimeout(resolve, delayTime));
            return refreshDownloadLink(cacheKey, id, pwd, env, retryCount + 1);
        }

        return false;
    }
}