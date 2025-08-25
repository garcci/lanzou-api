// utils/httpUtils.js
import { ErrorType, analyzeError, getRetryConfig, calculateRetryDelay } from './errorUtils.js';

const LANZOU_DOMAIN = "lanzoux.com";

// 常用请求头
const COMMON_HEADERS = {
    'Referer': `https://${LANZOU_DOMAIN}`,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Cache-Control': 'max-age=0'
};

// User-Agent列表，用于轮换
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Android 14; Mobile; rv:109.0) Gecko/121.0 Firefox/121.0'
];

// 获取随机User-Agent
function getRandomUserAgent() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// 延迟函数
export function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// 发送GET请求的函数
export async function getRequest(url, options = {}) {
  const {
    retries = 3,
    retryDelay = 1000,
    exponentialBackoff = true,
    userAgent = true,
    ...fetchOptions
  } = options;

  // 构建请求头
  const headers = {
    ...COMMON_HEADERS,
    ...fetchOptions.headers
  };

  // 如果启用User-Agent伪装，则添加随机User-Agent
  if (userAgent) {
    headers['User-Agent'] = getRandomUserAgent();
  }

  let lastError;

  for (let i = 0; i <= retries; i++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10秒超时

      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: controller.signal,
        ...fetchOptions
      });

      clearTimeout(timeoutId);

      // 检查响应状态
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return response;
    } catch (error) {
      lastError = error;
      console.error(`GET request failed (attempt ${i + 1}):`, error.message);

      // 如果不是最后一次尝试，则等待后重试
      if (i < retries) {
        let delay = retryDelay;
        if (exponentialBackoff) {
          delay *= Math.pow(2, i); // 指数退避
        }
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw new Error(`GET request failed after ${retries + 1} attempts: ${lastError.message}`);
}

// 发送POST请求的函数
export async function postRequest(url, data, options = {}) {
  const {
    retries = 3,
    retryDelay = 1000,
    exponentialBackoff = true,
    userAgent = true,
    ...fetchOptions
  } = options;

  // 构建请求头
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'X-Requested-With': 'XMLHttpRequest',
    ...COMMON_HEADERS,
    ...fetchOptions.headers
  };

  // 如果启用User-Agent伪装，则添加随机User-Agent
  if (userAgent) {
    headers['User-Agent'] = getRandomUserAgent();
  }

  // 将数据转换为URL编码格式
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(data)) {
    body.append(key, value);
  }

  let lastError;

  for (let i = 0; i <= retries; i++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10秒超时

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
        ...fetchOptions
      });

      clearTimeout(timeoutId);

      // 检查响应状态
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.text();
    } catch (error) {
      lastError = error;
      console.error(`POST request failed (attempt ${i + 1}):`, error.message);

      // 如果不是最后一次尝试，则等待后重试
      if (i < retries) {
        let delay = retryDelay;
        if (exponentialBackoff) {
          delay *= Math.pow(2, i); // 指数退避
        }
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw new Error(`POST request failed after ${retries + 1} attempts: ${lastError.message}`);
}