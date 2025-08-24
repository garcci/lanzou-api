// utils/requestCoalescer.js

class RequestCoalescer {
    constructor() {
        // 存储正在进行的请求
        this.pendingRequests = new Map();
    }

    // 添加或合并请求
    async addRequest(id, pwd, requestFunction) {
        const key = `${id}_${pwd || 'nopwd'}`;
        
        // 检查是否已经有相同ID的请求正在进行
        if (this.pendingRequests.has(key)) {
            // 如果有，直接返回该请求的Promise
            console.log(`Coalescing request for ${key}`);
            return this.pendingRequests.get(key);
        }

        // 如果没有，创建新请求
        console.log(`Creating new request for ${key}`);
        const promise = requestFunction().finally(() => {
            // 请求完成后，从pendingRequests中移除
            this.pendingRequests.delete(key);
        });

        // 将Promise存储到pendingRequests中
        this.pendingRequests.set(key, promise);
        return promise;
    }

    // 获取当前正在处理的请求数量
    getPendingRequestCount() {
        return this.pendingRequests.size;
    }

    // 获取特定请求的状态
    isRequestPending(id, pwd) {
        const key = `${id}_${pwd || 'nopwd'}`;
        return this.pendingRequests.has(key);
    }
}

// 创建全局实例
const requestCoalescer = new RequestCoalescer();

export default requestCoalescer;