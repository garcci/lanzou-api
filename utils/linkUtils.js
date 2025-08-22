// utils/linkUtils.js
import { getRequest, postRequest, delay } from './httpUtils.js';

const LANZOU_DOMAIN = "lanzoux.com";

// 提取signValue的函数（带重试机制）
export async function extractSignAndFileId(fileId, retryCount = 0) {
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

        if (retryCount < 2) {
            const delayTime = true
                ? 200 * Math.pow(2, retryCount)
                : 200;

            await delay(delayTime);
            return extractSignAndFileId(fileId, retryCount + 1);
        }

        throw error;
    }
}

// 跟踪重定向的函数（最多跟踪10次重定向）
export async function followRedirect(url, maxRedirects = 10) {
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
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Referer': `https://${LANZOU_DOMAIN}`,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'zh-CN,zh;q=0.9',
                'Connection': 'keep-alive'
            },
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
export async function checkUrlValidity(url) {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5秒超时

        const response = await fetch(url, {
            method: 'HEAD',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Referer': `https://${LANZOU_DOMAIN}`,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'zh-CN,zh;q=0.9',
                'Connection': 'keep-alive'
            },
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