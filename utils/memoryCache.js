// utils/memoryCache.js

// 简单的内存缓存实现
class MemoryCache {
    constructor() {
        this.cache = new Map();
        this.defaultTTL = 10 * 60 * 1000; // 默认10分钟过期时间
    }

    // 获取缓存项
    get(key) {
        const item = this.cache.get(key);
        if (!item) {
            return null;
        }

        // 检查是否过期
        if (Date.now() > item.expiry) {
            this.cache.delete(key);
            return null;
        }

        return item.value;
    }

    // 设置缓存项
    set(key, value, ttl = this.defaultTTL) {
        const expiry = Date.now() + ttl;
        this.cache.set(key, { value, expiry });
    }

    // 删除缓存项
    delete(key) {
        return this.cache.delete(key);
    }

    // 清空缓存
    clear() {
        this.cache.clear();
    }

    // 获取缓存大小
    size() {
        return this.cache.size;
    }

    // 清理过期项
    cleanup() {
        const now = Date.now();
        let count = 0;
        for (const [key, item] of this.cache.entries()) {
            if (now > item.expiry) {
                this.cache.delete(key);
                count++;
            }
        }
        return count;
    }
}

// 创建全局内存缓存实例
const memoryCache = new MemoryCache();

export default memoryCache;