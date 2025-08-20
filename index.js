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
async function getRequest(fileId) {
    const headers = { ...COMMON_HEADERS };

    const requestOptions = {
        method: 'GET',
        headers: headers,
        redirect: 'follow'
    };

    try {
        const response = await fetch(`https://${LANZOU_DOMAIN}/${fileId}`, requestOptions);
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
    const headers = { ...COMMON_HEADERS };
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
        const htmlContent = await getRequest(fileId);
        if (htmlContent.includes('sign') && htmlContent.includes('/ajaxm.php?file=')) {
            //前后有两个sign，要取第二个
            const signMatches = htmlContent.match(/'sign':'([^']+)'/g);
            if (!signMatches || signMatches.length < 2) {
                return null;
            }
            const signMatch = signMatches[1].match(/'sign':'([^']+)'/);

            // 从【$.ajax({
            // 			type : 'post',
            // 			url : '/ajaxm.php?file=249998205',】中获取249998205
            const fileMatch = htmlContent.match(/\/ajaxm\.php\?file=(\d+)/);
            if (signMatch && signMatch[1] && fileMatch && fileMatch[1]) {
                return {
                    fileId: fileMatch[1],
                    sign: signMatch[1],
                };
            }
        }
        return null;
    } catch (error) {
        console.error('Error extracting sign and file ID:', error);
        throw error;
    }
}

// 请求处理函数
async function requestHandler(request) {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    const pwd = url.searchParams.get('pwd');

    // 参数校验
    if (!id) {
        return new Response('Missing required parameter: id', { status: 400 });
    }

    try {
        const signAndFileId = await extractSignAndFileId(id);
        if (!signAndFileId) {
            return new Response('Sign value not found', { status: 404 });
        }

        const {fileId, sign} = signAndFileId;

        const postData = {
            action: "downprocess",
            sign: sign,
            kd: "1",
            p: pwd || "" // 确保pwd为字符串，即使未提供
        };

        // 处理异步请求并等待结果
        const response = await postRequest(`https://${LANZOU_DOMAIN}/ajaxm.php?file=${fileId}`, postData);
        const resultObj = JSON.parse(response);

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

// Cloudflare Worker 入口点
export default {
    async fetch(request) {
        return await requestHandler(request);
    }
};
