// utils/errorUtils.js

// 错误类型枚举
export const ErrorType = {
    NETWORK_ERROR: 'NETWORK_ERROR',
    TIMEOUT_ERROR: 'TIMEOUT_ERROR',
    SERVER_ERROR: 'SERVER_ERROR', 
    CLIENT_ERROR: 'CLIENT_ERROR',
    PARSE_ERROR: 'PARSE_ERROR',
    UNKNOWN_ERROR: 'UNKNOWN_ERROR'
};

// 分析错误类型
export function analyzeError(error) {
    if (!error || !error.message) {
        return ErrorType.UNKNOWN_ERROR;
    }

    const message = error.message.toLowerCase();
    
    // 网络错误
    if (error.name === 'FetchError' || 
        error.name === 'TypeError' ||
        message.includes('fetch') ||
        message.includes('network') ||
        message.includes('connection')) {
        return ErrorType.NETWORK_ERROR;
    }
    
    // 超时错误
    if (error.name === 'AbortError' ||
        message.includes('timeout') ||
        message.includes('aborted')) {
        return ErrorType.TIMEOUT_ERROR;
    }
    
    // 服务器错误 (5xx)
    if (message.includes('http 5') || 
        message.includes('internal server') ||
        message.includes('bad gateway') ||
        message.includes('service unavailable')) {
        return ErrorType.SERVER_ERROR;
    }
    
    // 客户端错误 (4xx)
    if (message.includes('http 4') ||
        message.includes('not found') ||
        message.includes('forbidden') ||
        message.includes('unauthorized')) {
        return ErrorType.CLIENT_ERROR;
    }
    
    // 解析错误
    if (error instanceof SyntaxError ||
        message.includes('json') ||
        message.includes('parse')) {
        return ErrorType.PARSE_ERROR;
    }
    
    return ErrorType.UNKNOWN_ERROR;
}

// 根据错误类型确定重试策略
export function getRetryConfig(errorType, baseRetryConfig) {
    const config = { ...baseRetryConfig };
    
    switch (errorType) {
        case ErrorType.NETWORK_ERROR:
            // 网络错误：立即重试，最多3次
            config.maxRetries = 3;
            config.exponentialBackoff = false;
            config.jitter = false;
            break;
            
        case ErrorType.TIMEOUT_ERROR:
            // 超时错误：指数退避重试，最多3次
            config.maxRetries = 3;
            config.exponentialBackoff = true;
            config.jitter = true;
            break;
            
        case ErrorType.SERVER_ERROR:
            // 服务器错误：指数退避重试，最多2次
            config.maxRetries = 2;
            config.exponentialBackoff = true;
            config.jitter = true;
            break;
            
        case ErrorType.CLIENT_ERROR:
            // 客户端错误：不重试或少量重试
            config.maxRetries = 0;
            break;
            
        case ErrorType.PARSE_ERROR:
            // 解析错误：少量重试
            config.maxRetries = 1;
            config.exponentialBackoff = false;
            config.jitter = false;
            break;
            
        default:
            // 未知错误：使用默认配置
            break;
    }
    
    return config;
}

// 计算重试延迟时间
export function calculateRetryDelay(retryConfig, retryCount) {
    let delay = retryConfig.retryDelay;
    
    // 指数退避
    if (retryConfig.exponentialBackoff) {
        delay = retryConfig.retryDelay * Math.pow(2, retryCount);
    }
    
    // 添加抖动避免惊群效应
    if (retryConfig.jitter) {
        const jitter = Math.random() * 0.5 + 0.75; // 0.75-1.25之间的随机数
        delay = delay * jitter;
    }
    
    // 限制最大延迟
    if (retryConfig.maxDelay) {
        delay = Math.min(delay, retryConfig.maxDelay);
    }
    
    return delay;
}