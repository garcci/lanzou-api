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
};

// GET请求函数
async function getRequest(url) {
    const headers = {...COMMON_HEADERS};

    const requestOptions = {
        method: 'GET',
        headers: headers,
        redirect: 'follow'
    };

    try {
        const response = await fetch(url, requestOptions);
        if (!response.ok) {
            return null;
        }
        return await response.text();
    } catch (error) {
        console.error('Error in GET request:', error);
        throw error;
    }
}

// POST请求函数
async function postRequest(url, data) {
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
            return null;
        }
        return await response.text();
    } catch (error) {
        console.error('Error in POST request:', error);
        throw error;
    }
}

// 提取signValue的函数
async function extractSignAndFileId(fileId) {
    try {
        const htmlContent = await getRequest(`https://${LANZOU_DOMAIN}/${fileId}`);
        if (htmlContent.includes('sign') && htmlContent.includes('/ajaxm.php?file=')) {
            const signMatches = htmlContent.match(/'sign':'([^']+)'/g);
            if (!signMatches || signMatches.length < 2) {
                return null;
            }
            const signMatch = signMatches[1].match(/'sign':'([^']+)'/);
            const fileMatch = htmlContent.match(/\/ajaxm\.php\?file=(\d+)/);
            if (signMatch && signMatch[1] && fileMatch && fileMatch[1]) {
                return {
                    fileId: fileMatch[1],
                    sign: signMatch[1],
                };
            }
        }
        if (htmlContent.includes('src="/fn?')) {
            const fnMatch = htmlContent.match(/src="\/fn\?([^"]+)"/);
            if (fnMatch && fnMatch[1]) {
                const fn = fnMatch[1];
                try {
                    const fnContent = await getRequest(`https://${LANZOU_DOMAIN}/fn?${fn}`);
                    if (fnContent.includes('wp_sign') && fnContent.includes('/ajaxm.php?file=')) {
                        const fileMatchs = fnContent.match(/\/ajaxm\.php\?file=(\d+)/g);
                        if (!fileMatchs || fileMatchs.length < 2) {
                            return null;
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
                    return null;
                }
            }
        }
        return null;
    } catch (error) {
        console.error('Error extracting sign and file ID:', error);
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

    try {
        const signAndFileId = await extractSignAndFileId(id);
        if (!signAndFileId) {
            return new Response('Sign value not found', { status: 404 });
        }

        // 如果返回了重定向URL
        if (signAndFileId.redirect) {
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
