import { UserInfo, Comment } from './types.js';

// 工具函数模块 - 通用工具函数
import { join, dirname } from 'path';
import { writeFile, mkdir } from 'fs/promises';
import { CONFIG } from './config.js';

/**
 * 延迟执行
 * @param ms 延迟毫秒数
 */
export function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// 重试函数
export async function retry<T>(fn: () => Promise<T>, maxRetries = CONFIG.maxRetries, retryDelay = CONFIG.retryDelay): Promise<T> {
    let lastError: Error | undefined;
    
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error as Error;
            if (i < maxRetries - 1) {
                if (process.env.DEBUG_MODE === 'true') {
                    console.warn(`重试 ${i + 1}/${maxRetries}: ${lastError.message}`);
                }
                await delay(retryDelay);
            }
        }
    }
    
    throw lastError!;
}

/**
 * 从URL获取资源文件名
 * @param url 资源URL
 * @returns 文件名
 */
export function getResourceFilename(url: string): string {
    try {
        const urlObj = new URL(url);
        const pathname = urlObj.pathname;
        const filename = pathname.split('/').pop() || 'unknown';
        
        // 如果没有扩展名，根据URL特征添加
        if (!filename.includes('.')) {
            if (url.includes('gif') || url.includes('animation')) {
                return filename + '.gif';
            } else if (url.includes('image') || url.includes('icon')) {
                return filename + '.png';
            }
            return filename + '.png';
        }
        
        return filename;
    } catch (error) {
        // 如果URL解析失败，生成一个基于时间戳的文件名
        return `resource_${Date.now()}.png`;
    }
}

// 获取用户头像文件路径
export function getUserAvatarPath(userId: string, avatarUrl: string): string {
    try {
        const urlObj = new URL(avatarUrl);
        const pathname = urlObj.pathname;
        const extension = pathname.split('.').pop() || 'png';
        const filename = `${userId}.${extension}`;
        
        return join(CONFIG.downloadDir, CONFIG.avatarDir, filename);
    } catch (error) {
        return join(CONFIG.downloadDir, CONFIG.avatarDir, `${userId}.png`);
    }
}

/**
 * 确保目录存在，如果不存在则创建
 * @param dirPath 目录路径
 */
export async function ensureDir(dirPath: string): Promise<void> {
    await mkdir(dirPath, { recursive: true });
}

/**
 * 保存JSON数据到文件
 * @param data 要保存的数据
 * @param filePath 文件路径
 */
export async function saveJson(data: any, filePath: string): Promise<void> {
    await ensureDir(dirname(filePath));
    await writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * 安全的文件名处理
 * @param filename 原始文件名
 * @returns 安全的文件名
 */
export function sanitizeFilename(filename: string): string {
    return filename.replace(/[<>:"/\\|?*]/g, '_');
}

// 格式化文件大小
export function formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * 格式化时间戳为可读格式
 * @param timestamp 时间戳
 * @returns 格式化的时间字符串
 */
export function formatTimestamp(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

/**
 * 提取唯一用户ID
 * @param commentData 评论数据数组
 * @returns 唯一用户ID集合
 */
export function extractUniqueUserIds(commentData: Comment[]): string[] {
    const userIds = new Set<string>();
    
    commentData.forEach(comment => {
        if (comment.user_id) {
            userIds.add(comment.user_id);
        }
    });
    
    return Array.from(userIds);
}

/**
 * 合并用户信息到评论数据
 * @param commentData 评论数据数组
 * @param userInfoMap 用户信息映射
 * @returns 合并后的评论数据
 */
export function mergeUserInfoToComments(commentData: Comment[], userInfoMap: Map<string, UserInfo>): Comment[] {
    return commentData.map(comment => {
        if (comment.user_id) {
            const userInfo = userInfoMap.get(comment.user_id);
            if (userInfo) {
                return {
                    ...comment,
                    userInfo: userInfo
                };
            }
        }
        return comment;
    });
}

/**
 * 创建HTTP请求头
 * @param token 认证token
 * @param url 请求URL
 * @param sessionId
 * @returns HTTP请求头对象
 */
export function createHeaders(token: string, url: string, sessionId?: string): Record<string, string> {
    // 构建Cookie字符串
    let cookieValue = `nglives_pltk=${token}`;
    if (sessionId) {
        cookieValue += `; Z-aN_sid=${sessionId}`;
    }
    
    return {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:142.0) Gecko/20100101 Firefox/142.0',
        'Cookie': cookieValue,
        'Referer': url,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.8,zh-TW;q=0.7,zh-HK;q=0.5,en-US;q=0.3,en;q=0.2',
        'Accept-Encoding': 'gzip, deflate, br, zstd',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-GPC': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-User': '?1',
        'Priority': 'u=0, i'
    };
}

/**
 * 创建JSON请求头
 * @param token 认证token
 * @param url 请求URL
 * @param sessionId
 * @returns JSON请求头对象
 */
export function createJsonHeaders(token: string, url: string, sessionId?: string): Record<string, string> {
    return {
        ...createHeaders(token, url, sessionId),
        'Accept': 'application/json'
    };
}

// 验证URL格式
export function isValidUrl(string: string): boolean {
    try {
        new URL(string);
        return true;
    } catch (_) {
        return false;
    }
}

// 日志工具
export const logger = {
    // 调试信息，只在debug模式下显示
    debug: (message: string, ...args: any[]) => {
        if (process.env.DEBUG_MODE === 'true') {
            console.log(`[DEBUG] ${message}`, ...args);
        }
    },
    
    // 错误信息，始终显示
    error: (message: string, ...args: any[]) => {
        console.error(`[ERROR] ${message}`, ...args);
    },
    
    // 进度条，始终显示，在同一行更新
    progressBar: (message: string, current: number, total: number) => {
        const percentage = Math.round((current / total) * 100);
        const barLength = 20;
        const filledLength = Math.round((barLength * current) / total);
        const bar = '='.repeat(filledLength) + ' '.repeat(barLength - filledLength);
        const output = `${message}: ${percentage}% [${bar}]`;
        
        // 清除当前行并输出新内容
        process.stdout.write('\r' + output);
        
        // 如果完成了，换行
        if (current >= total) {
            process.stdout.write('\n');
        }
    },
    
    // 兼容性方法，保持向后兼容
    info: (message: string, ...args: any[]) => {
        if (process.env.DEBUG_MODE === 'true') {
            console.log(`[INFO] ${message}`, ...args);
        }
    },
    success: (message: string, ...args: any[]) => {
        if (process.env.DEBUG_MODE === 'true') {
            console.log(`[SUCCESS] ${message}`, ...args);
        }
    },
    warn: (message: string, ...args: any[]) => {
        if (process.env.DEBUG_MODE === 'true') {
            console.warn(`[WARN] ${message}`, ...args);
        }
    },
    progress: (current: number, total: number, message: string) => {
        const percentage = Math.round((current / total) * 100);
        const barLength = 20;
        const filledLength = Math.round((barLength * current) / total);
        const bar = '='.repeat(filledLength) + ' '.repeat(barLength - filledLength);
        console.log(`${message}: ${percentage}% [${bar}]`);
    }
};