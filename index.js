const LANZOU_DOMAIN = "lanzoux.com";

// 统一的请求头 - 使用函数生成以减少内存开销
function getCommonHeaders() {
    return {
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
}

// 并发控制 - 限制同时进行的请求数量
const MAX_CONCURRENT_REQUESTS = 5; // 减少并发数以降低内存使用
let activeRequests = 0;
let requestQueue = [];

function randIP() {
    function r() { return Math.round(Math.random() * (2550000 - 600000) + 600000) % 256 }
    const ip2id = r();
    const ip3id = r();
    const ip4id = r();
    const arr_1 = ["218", "218", "66", "66", "218", "218", "60", "60", "202", "204", "66", "66", "66", "59", "61", "60", "222", "221", "66", "59", "60", "60", "66", "218", "218", "62", "63", "64", "66", "66", "122", "211"];
    const randIndex = Math.floor(Math.random() * arr_1.length);
    const ip1id = arr_1[randIndex];
    return `${ip1id}.${ip2id}.${ip3id}.${ip4id}`;
}

// 重试配置
const RETRY_CONFIG = {
    maxRetries: 2, // 减少重试次数以降低资源消耗
    retryDelay: 300,
    exponentialBackoff: true
};

// 请求超时配置
const TIMEOUT_CONFIG = {
    getRequest: 8000,
    postRequest: 8000
};

// 延迟函数
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// 带超时控制的fetch包装函数
function fetchWithTimeout(url, options, timeout) {
    return Promise.race([
        fetch(url, options),
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Request timeout')), timeout)
        )
    ]);
}

// 并发控制包装函数
function withConcurrencyControl(fn) {
    return function(...args) {
        return new Promise((resolve, reject) => {
            // 如果队列过长，直接拒绝新请求以防止内存溢出
            if (requestQueue.length > 50) {
                reject(new Error('Too many requests'));
                return;
            }
            
            requestQueue.push({ fn, args, resolve, reject });
            processQueue();
        });
    };
}

// 处理请求队列
function processQueue() {
    if (activeRequests >= MAX_CONCURRENT_REQUESTS || requestQueue.length === 0) {
        return;
    }

    const { fn, args, resolve, reject } = requestQueue.shift();
    activeRequests++;

    Promise.resolve(fn.apply(this, args))
        .then(result => {
            resolve(result);
        })
        .catch(error => {
            reject(error);
        })
        .finally(() => {
            activeRequests--;
            processQueue();
        });
}

// GET请求函数（带重试机制和并发控制）
async function getRequest(url, retryCount = 0, options = {}) {
    const headers = getCommonHeaders();

    const requestOptions = {
        method: 'GET',
        headers: headers,
        redirect: options.followRedirect === false ? 'manual' : 'follow'
    };

    try {
        const response = await fetchWithTimeout(url, requestOptions, TIMEOUT_CONFIG.getRequest);
        if (!response.ok && response.status !== 302) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
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

// POST请求函数（带重试机制和并发控制）
async function postRequest(url, data, retryCount = 0) {
    const headers = getCommonHeaders();
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
        const response = await fetchWithTimeout(url, requestOptions, TIMEOUT_CONFIG.postRequest);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
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

// 为请求函数添加并发控制
const controlledGetRequest = withConcurrencyControl(getRequest);
const controlledPostRequest = withConcurrencyControl(postRequest);

// 提取signValue的函数（带重试机制）
async function extractSignAndFileId(fileId, retryCount = 0) {
    try {
        const htmlContent = await controlledGetRequest(`https://${LANZOU_DOMAIN}/${fileId}`);
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
                    const fnContentResponse = await controlledGetRequest(`https://${LANZOU_DOMAIN}/fn?${fn}`);
                    const fnContent = await fnContentResponse.text();
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
                            const response = await controlledPostRequest(`https://${LANZOU_DOMAIN}/ajaxm.php?file=${fileId}`, postData);
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

// 创建缓存对象来存储下载链接 - 限制缓存大小
const downloadCache = new Map();
const MAX_CACHE_SIZE = 100; // 限制缓存大小

// 简化缓存管理
function setCache(key, value) {
    // 如果缓存已满，删除最旧的条目
    if (downloadCache.size >= MAX_CACHE_SIZE) {
        const firstKey = downloadCache.keys().next().value;
        downloadCache.delete(firstKey);
    }
    downloadCache.set(key, {
        ...value,
        timestamp: Date.now()
    });
}

// 跟踪重定向地址的函数
async function followRedirect(url, maxRedirects = 5) {
    if (maxRedirects <= 0) {
        return url;
    }

    try {
        const response = await fetch(url, { 
            method: 'HEAD', 
            redirect: 'manual',
            headers: getCommonHeaders()
        });
        
        if (response.status === 302 || response.status === 301) {
            const location = response.headers.get('location');
            if (location) {
                // 处理相对路径
                const absoluteUrl = new URL(location, url).href;
                return await followRedirect(absoluteUrl, maxRedirects - 1);
            }
        }
        
        return url;
    } catch (error) {
        console.error('Error following redirect:', error);
        return url;
    }
}

// 创建统一的处理函数
async function handleDownloadRequest(request) {
    const url = new URL(request.url);
    const paths = url.pathname.split('/').filter(Boolean);

    const id = paths[0];
    const pwd = paths[1] || null;

    if (!id) {
        return new Response('Missing required parameter: id', { status: 400 });
    }

    // 检查缓存中是否已有下载链接
    const cacheKey = `${id}-${pwd || ''}`;
    const cachedResult = downloadCache.get(cacheKey);
    if (cachedResult && Date.now() - cachedResult.timestamp < 5 * 60 * 1000) { // 缩短缓存时间以减少内存使用
        let finalUrl = cachedResult.redirect || cachedResult.realDownloadUrl;
        if (!finalUrl) {
            finalUrl = cachedResult.dom + "/file/" + cachedResult.url;
        }
        
        // 跟踪重定向
        const resolvedUrl = await followRedirect(finalUrl);
        return Response.redirect(resolvedUrl, 302);
    }

    try {
        const signAndFileId = await extractSignAndFileId(id);
        if (!signAndFileId) {
            return new Response('Sign value not found', { status: 404 });
        }

        if (signAndFileId.redirect) {
            // 跟踪重定向
            const resolvedUrl = await followRedirect(signAndFileId.redirect);
            setCache(cacheKey, {
                redirect: resolvedUrl
            });
            return Response.redirect(resolvedUrl, 302);
        }

        const { fileId, sign } = signAndFileId;

        const postData = {
            action: "downprocess",
            sign: sign,
            kd: "1",
            p: pwd || ""
        };

        const response = await controlledPostRequest(`https://${LANZOU_DOMAIN}/ajaxm.php?file=${fileId}`, postData);

        let resultObj;
        try {
            resultObj = JSON.parse(response);
        } catch (parseError) {
            console.error('Failed to parse JSON response:', response);
            return new Response('Invalid response from upstream server', { status: 502 });
        }

        if (resultObj && resultObj.url) {
            const downloadUrl = resultObj.dom + "/file/" + resultObj.url;
            // 跟踪重定向
            const resolvedUrl = await followRedirect(downloadUrl);
            setCache(cacheKey, { ...resultObj, redirect: resolvedUrl });
            return Response.redirect(resolvedUrl, 302);
        }

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
