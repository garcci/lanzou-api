const LANZOU_DOMAIN = "lanzoux.com";

// 统一的请求头
const COMMON_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    Referer: `https://${LANZOU_DOMAIN}`,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
    'Accept-Encoding': 'gzip, deflate',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Pragma': 'no-cache',
    'Upgrade-Insecure-Requests': '1',
    'Cookie': "down_ip=1; expires=Sat, 16-Nov-2090 11:42:54 GMT; path=/; domain=.baidupan.com",
    'X-Forwarded-For': randIP(),
    'CLIENT-IP': randIP(),
};
function randIP() {
    function r() { return Math.round(Math.random() * (2550000 - 600000) + 600000) % 256 }
    const ip2id = r(); // 获取 0-255 之间的值
    const ip3id = r(); // 获取 0-255 之间的值
    const ip4id = r(); // 获取 0-255 之间的值
    const arr_1 = ["218", "218", "66", "66", "218", "218", "60", "60", "202", "204", "66", "66", "66", "59", "61", "60", "222", "221", "66", "59", "60", "60", "66", "218", "218", "62", "63", "64", "66", "66", "122", "211"];
    const randIndex = Math.floor(Math.random() * arr_1.length);
    const ip1id = arr_1[randIndex];
    return `${ip1id}.${ip2id}.${ip3id}.${ip4id}`;
}
// 重试配置
const RETRY_CONFIG = {
    maxRetries: 10,
    retryDelay: 100,
    exponentialBackoff: true
};

// 延迟函数
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// GET请求函数（带重试机制）
async function getRequest(url, retryCount = 0, options = {}) {
    const headers = {...COMMON_HEADERS};

    const requestOptions = {
        method: 'GET',
        headers: headers,
        redirect: options.followRedirect === false ? 'manual' : 'follow'
    };

    try {
        const response = await fetch(url, requestOptions);
        if (!response.ok && response.status !== 302) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return response;
    } catch (error) {
        console.error(`Error in GET request (attempt ${retryCount + 1}):`, error.message);

        // 检查是否应该重试
        if (retryCount < RETRY_CONFIG.maxRetries) {
            const delayTime = RETRY_CONFIG.exponentialBackoff
                ? RETRY_CONFIG.retryDelay * Math.pow(2, retryCount)
                : RETRY_CONFIG.retryDelay;

            console.log(`Retrying GET request in ${delayTime}ms...`);
            await delay(delayTime);

            return getRequest(url, retryCount + 1, options);
        }

        console.error('Max retries reached for GET request');
        throw error;
    }
}

// POST请求函数（带重试机制）
async function postRequest(url, data, retryCount = 0) {
    const headers = {...COMMON_HEADERS};
    // 设置正确的Content-Type以配合URLSearchParams使用
    headers['Content-Type'] = 'application/x-www-form-urlencoded';

    const formData = new URLSearchParams();
    for (const [key, value] of Object.entries(data)) {
        formData.append(key, value);
    }

    const requestOptions = {
        method: 'POST',
        headers: headers,
        body: formData,
        redirect: 'follow'
    };

    try {
        const response = await fetch(url, requestOptions);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return await response.text();
    } catch (error) {
        console.error(`Error in POST request (attempt ${retryCount + 1}):`, error.message);

        // 检查是否应该重试
        if (retryCount < RETRY_CONFIG.maxRetries) {
            const delayTime = RETRY_CONFIG.exponentialBackoff
                ? RETRY_CONFIG.retryDelay * Math.pow(2, retryCount)
                : RETRY_CONFIG.retryDelay;

            console.log(`Retrying POST request in ${delayTime}ms...`);
            await delay(delayTime);

            return postRequest(url, data, retryCount + 1);
        }

        console.error('Max retries reached for POST request');
        throw error;
    }
}

// 提取signValue的函数（带重试机制）
async function extractSignAndFileId(fileId, retryCount = 0) {
    try {
        const htmlContent = await getRequest(`https://${LANZOU_DOMAIN}/${fileId}`);
        const htmlText = await htmlContent.text();
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
                    const fnContentResponse = await getRequest(`https://${LANZOU_DOMAIN}/fn?${fn}`);
                    const fnContent = await fnContentResponse.text();
                    if (fnContent.includes('wp_sign') && fnContent.includes('/ajaxm.php?file=')) {
                        const fileMatchs = fnContent.match(/\/ajaxm\.php\?file=(\d+)/g);
                        if (!fileMatchs || fileMatchs.length < 2) {
                            throw new Error('File matches not found or insufficient matches');
                        }
                        const fileMatch = fileMatchs[1].match(/\/ajaxm\.php\?file=(\d+)/);
                        // 有两个fileId，取第二个
                        if (fileMatch && fileMatch[1]) {
                            const fileId = fileMatch[1];
                            // 从【wp_sign = 'B2ECPF1sUmMACQI9AjIFOQRsDj5QP1NgAzZaZVA_bBDEIOABxWnMGbwJlBGUGZ1VhVDgHNQNkADYKPgY2';】取出【B2ECPF1sUmMACQI9AjIFOQRsDj5QP1NgAzZaZVA_bBDEIOABxWnMGbwJlBGUGZ1VhVDgHNQNkADYKPgY2】
                            const wp_sign = fnContent.match(/wp_sign\s*=\s*'([^']+)'/)[1];
                            // 从【ajaxdata = 'c1Re';】中取出【c1Re】
                            const ajaxdata = fnContent.match(/ajaxdata\s*=\s*'([^']+)'/)[1];
                            const postData = {
                                action: "downprocess",
                                websignkey: ajaxdata,
                                signs: ajaxdata,
                                sign: wp_sign,
                                websign: "",
                                kd: "1",
                                ves: "1" // 确保pwd为字符串，即使未提供
                            };
                            // 处理异步请求并等待结果
                            const response = await postRequest(`https://${LANZOU_DOMAIN}/ajaxm.php?file=${fileId}`, postData);
                            const resultObj = JSON.parse(response);

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

        // 检查是否应该重试
        if (retryCount < RETRY_CONFIG.maxRetries) {
            const delayTime = RETRY_CONFIG.exponentialBackoff
                ? RETRY_CONFIG.retryDelay * Math.pow(2, retryCount)
                : RETRY_CONFIG.retryDelay;

            console.log(`Retrying extractSignAndFileId in ${delayTime}ms...`);
            await delay(delayTime);

            return extractSignAndFileId(fileId, retryCount + 1);
        }

        console.error('Max retries reached for extractSignAndFileId');
        throw error;
    }
}

// 创建缓存对象来存储下载链接
const downloadCache = new Map();

// 递归解析重定向URL，直到找到最终下载地址
async function resolveFinalUrl(url, maxRedirects = 10) {
    if (maxRedirects <= 0) {
        throw new Error('Maximum redirect limit reached');
    }

    try {
        const response = await getRequest(url, 0, { followRedirect: false });
        const location = response.headers.get('location');

        if (location) {
            // 如果有重定向，递归解析
            return await resolveFinalUrl(location, maxRedirects - 1);
        } else {
            // 没有更多重定向，返回当前URL
            return url;
        }
    } catch (error) {
        console.error('Error resolving final URL:', error);
        throw error;
    }
}

// 创建统一的处理函数
async function handleDownloadRequest(request) {
    const url = new URL(request.url);
    const paths = url.pathname.split('/').filter(Boolean);

    const id = paths[0];
    const pwd = paths[1] || null; // 如果没有密码，则设为null

    // 参数校验
    if (!id) {
        return new Response('Missing required parameter: id', { status: 400 });
    }

    // 检查缓存中是否已有下载链接
    const cacheKey = `${id}-${pwd || ''}`;
    const cachedResult = downloadCache.get(cacheKey);
    if (cachedResult && Date.now() - cachedResult.timestamp < 10 * 60 * 1000) { // 10分钟缓存
        console.log('Returning cached download URL');
        if (cachedResult.redirect) {
            return Response.redirect(cachedResult.redirect, 302);
        }
        if (cachedResult.realDownloadUrl) {
            return Response.redirect(cachedResult.realDownloadUrl, 302);
        }
        const downloadUrl = cachedResult.dom + "/file/" + cachedResult.url;
        return Response.redirect(downloadUrl, 302);
    }

    try {
        const signAndFileId = await extractSignAndFileId(id);
        if (!signAndFileId) {
            return new Response('Sign value not found', { status: 404 });
        }

        // 如果返回了重定向URL
        if (signAndFileId.redirect) {
            // 缓存结果
            downloadCache.set(cacheKey, {
                redirect: signAndFileId.redirect,
                timestamp: Date.now()
            });
            return Response.redirect(signAndFileId.redirect, 302);
        }

        const { fileId, sign } = signAndFileId;

        const postData = {
            action: "downprocess",
            sign: sign,
            kd: "1",
            p: pwd || "" // 确保pwd为字符串，即使未提供
        };

        // 处理异步请求并等待结果
        const response = await postRequest(`https://${LANZOU_DOMAIN}/ajaxm.php?file=${fileId}`, postData);

        let resultObj;
        try {
            resultObj = JSON.parse(response);
        } catch (parseError) {
            console.error('Failed to parse JSON response:', response);
            return new Response('Invalid response from upstream server', { status: 502 });
        }

        if (resultObj && resultObj.url) {
            const downloadUrl = resultObj.dom + "/file/" + resultObj.url;
            
            // 递归解析重定向以获取最终下载地址
            try {
                const finalDownloadUrl = await resolveFinalUrl(downloadUrl);
                
                if (finalDownloadUrl) {
                    // 缓存真实的下载链接
                    downloadCache.set(cacheKey, {
                        ...resultObj,
                        realDownloadUrl: finalDownloadUrl,
                        timestamp: Date.now()
                    });
                    return Response.redirect(finalDownloadUrl, 302);
                }
            } catch (redirectError) {
                console.error('Error getting final download URL:', redirectError);
                // 如果获取真实链接失败，仍然使用原始链接
                downloadCache.set(cacheKey, {
                    ...resultObj,
                    timestamp: Date.now()
                });
                return Response.redirect(downloadUrl, 302);
            }
            
            // 重定向到下载链接
            return Response.redirect(downloadUrl, 302);
        }

        console.log("Unexpected response:", response);
        return new Response('Internal Server Error', { status: 500 });
    } catch (error) {
        console.error('Error processing request:', error);
        return new Response('Internal Server Error', { status: 500 });
    }
}

// Cloudflare Workers 入口点
export default {
    async fetch(request) {
        return await handleDownloadRequest(request);
    }
};
