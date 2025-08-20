const express = require('express');
const app = express();
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

// 路由处理函数
app.get('/', requestHandler);

// GET请求函数
async function getRequest(fileId) {
    const headers = {...COMMON_HEADERS};

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
async function extractSignAndFileId(fileId, res) {
    try {
        const htmlContent = await getRequest(fileId);
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
                const headers = {...COMMON_HEADERS};

                const requestOptions = {
                    method: 'GET',
                    headers: headers,
                    redirect: 'follow'
                };

                try {
                    const response = await fetch(`https://${LANZOU_DOMAIN}/fn?${fn}`, requestOptions);
                    if (!response.ok) {
                        return null;
                    }
                    const fnContent = await response.text();
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
                                // 重定向到下载链接
                                return res.redirect(downloadUrl);
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

// 请求处理函数
async function requestHandler(req, res) {
    const {id, pwd} = req.query;

    // 参数校验
    if (!id) {
        return res.status(400).send('Missing required parameter: id');
    }

    try {
        const signAndFileId = await extractSignAndFileId(id, res);
        if (!signAndFileId) {
            // 如果 extractSignAndFileId 已经处理了重定向，则直接返回
            if (res.headersSent) {
                return;
            }
            return res.status(404).send('Sign value not found');
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
            return res.redirect(downloadUrl);
        }

        console.log("Unexpected response:", response);
        return res.status(500).send('Internal Server Error');
    } catch (error) {
        console.error('Error processing request:', error);
        return res.status(500).send('Internal Server Error');
    }
}

// 服务器启动函数
function startServer() {
    const server = app.listen(3000, () => {
        console.log('Server is running on port 3000');
    });

    // 优雅关闭服务器
    process.on('SIGINT', () => {
        console.log('Shutting down server...');
        server.close(() => {
            console.log('Server closed.');
            process.exit(0);
        });
    });
}

// 启动服务器
startServer();
