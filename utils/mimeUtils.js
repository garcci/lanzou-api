// utils/mimeUtils.js

/**
 * 根据文件扩展名获取对应的MIME类型
 * @param {string} url - 文件URL
 * @returns {string|null} MIME类型，如果未找到则返回null
 */
export function getMimeTypeFromUrl(url) {
    if (!url) return null;
    
    // 常见图片格式映射
    const imageTypes = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.bmp': 'image/bmp',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon'
    };
    
    // 常见视频格式映射
    const videoTypes = {
        '.mp4': 'video/mp4',
        '.webm': 'video/webm',
        '.mov': 'video/quicktime',
        '.avi': 'video/x-msvideo',
        '.mkv': 'video/x-matroska',
        '.flv': 'video/x-flv',
        '.wmv': 'video/x-ms-wmv'
    };
    
    // 常见音频格式映射
    const audioTypes = {
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
        '.ogg': 'audio/ogg',
        '.m4a': 'audio/mp4',
        '.flac': 'audio/flac',
        '.aac': 'audio/aac'
    };
    
    // 常见文档格式映射
    const documentTypes = {
        '.pdf': 'application/pdf',
        '.txt': 'text/plain',
        '.html': 'text/html',
        '.htm': 'text/html',
        '.css': 'text/css',
        '.js': 'application/javascript',
        '.json': 'application/json'
    };
    
    // 将所有类型合并到一个映射对象中
    const mimeTypes = {
        ...imageTypes,
        ...videoTypes,
        ...audioTypes,
        ...documentTypes
    };
    
    // 提取URL中的文件扩展名
    try {
        const urlObj = new URL(url);
        const pathname = urlObj.pathname.toLowerCase();
        
        // 查找最后一个点的位置
        const lastDotIndex = pathname.lastIndexOf('.');
        if (lastDotIndex === -1) return null;
        
        // 提取扩展名
        const extension = pathname.substring(lastDotIndex);
        
        // 返回对应的MIME类型
        return mimeTypes[extension] || null;
    } catch (e) {
        console.error('Error parsing URL for MIME type:', url, e);
        return null;
    }
}

/**
 * 根据MIME类型判断是否应该内联显示
 * @param {string} mimeType - MIME类型
 * @returns {boolean} 是否应该内联显示
 */
export function shouldDisplayInline(mimeType) {
    if (!mimeType) return false;
    
    // 定义应该内联显示的MIME类型
    const inlineTypes = [
        'image/',
        'video/',
        'audio/',
        'text/',
        'application/pdf'
    ];
    
    return inlineTypes.some(type => mimeType.startsWith(type));
}