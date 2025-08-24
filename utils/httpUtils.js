// utils/httpUtils.js
import { ErrorType, analyzeError, getRetryConfig, calculateRetryDelay } from './errorUtils.js';

const LANZOU_DOMAIN = "lanzoux.com";

// 统一的请求头
export function getCommonHeaders() {
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

// 生成随机IP地址
export function randIP() {
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

// 延迟函数
export function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// GET请求函数（带重试机制）
export async function getRequest(url, retryCount = 0, options = {}) {
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

        // 分析错误类型并获取相应的重试配置
        const errorType = analyzeError(error);
        const retryConfig = getRetryConfig(errorType, {
            maxRetries: 2,
            retryDelay: 200,
            exponentialBackoff: true,
            jitter: true,
            maxDelay: 10000
        });
        
        if (retryCount < retryConfig.maxRetries) {
            const delayTime = calculateRetryDelay(retryConfig, retryCount);
            
            console.log(`Retrying GET request due to ${errorType} (attempt ${retryCount + 1}/${retryConfig.maxRetries}), delay: ${delayTime}ms`);
            await delay(delayTime);
            return getRequest(url, retryCount + 1, options);
        }

        throw error;
    }
}

// POST请求函数（带重试机制）
export async function postRequest(url, data, retryCount = 0) {
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

        // 分析错误类型并获取相应的重试配置
        const errorType = analyzeError(error);
        const retryConfig = getRetryConfig(errorType, {
            maxRetries: 2,
            retryDelay: 200,
            exponentialBackoff: true,
            jitter: true,
            maxDelay: 10000
        });
        
        if (retryCount < retryConfig.maxRetries) {
            const delayTime = calculateRetryDelay(retryConfig, retryCount);
            
            console.log(`Retrying POST request due to ${errorType} (attempt ${retryCount + 1}/${retryConfig.maxRetries}), delay: ${delayTime}ms`);
            await delay(delayTime);
            return postRequest(url, data, retryCount + 1);
        }

        throw error;
    }
}