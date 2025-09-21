// 资源下载器模块 - 处理头像、图片和GIF资源下载
import { join } from 'path';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { Comment } from './types.js';

// 临时定义ParsedPageData接口，直到types.js中添加
interface ParsedPageData {
    liveId: string;
    liveName: string;
    resourceUrls: string[];
    vodCommentManifestUrl?: string;
    commentWsUrl?: string;
    commentPull?: string;
    apiEndpointUrl?: string;
}
import { CONFIG } from './config.js';
import { createHeaders, delay, ensureDir, logger } from './utils.js';

export interface ResourceInfo {
    url: string;
    filename: string;
    type: 'image' | 'video' | 'audio' | 'other';
}

export class ResourceDownloader {
    private token: string;
    private url: string;
    private outputDir: string;
    private sessionId?: string;

    constructor(token: string, url: string, outputDir: string, sessionId?: string) {
        this.token = token;
        this.url = url;
        this.outputDir = outputDir;
        this.sessionId = sessionId;
    }

    /**
     * 下载所有资源
     */
    async downloadAllResources(commentData: Comment[], pageData: ParsedPageData): Promise<void> {
        logger.debug('开始下载资源...');
        logger.progressBar('下载资源', 0, 100);

        // 并行下载头像和页面资源
        await Promise.all([
            this.downloadAvatars(commentData),
            this.downloadPageResources(pageData)
        ]);

        logger.progressBar('下载资源', 100, 100);
        logger.debug('所有资源下载完成');
    }

    /**
     * 下载用户头像
     */
    async downloadAvatars(comments: Comment[]): Promise<void> {
        const uniqueAvatars = new Map<string, string>();
        
        // 收集唯一的头像URL
        for (const comment of comments) {
            if (comment.userInfo?.profileImageUrl) {
                const fileName = `${comment.user_id}.jpg`;
                uniqueAvatars.set(comment.userInfo.profileImageUrl, fileName);
            }
        }

        if (uniqueAvatars.size === 0) {
            logger.debug('没有找到需要下载的头像');
            return;
        }

        logger.debug(`开始下载 ${uniqueAvatars.size} 个头像...`);

        // 创建头像目录
        const avatarDir = join(this.outputDir, CONFIG.avatarDir);
        await ensureDir(avatarDir);

        let downloaded = 0;
        const totalAvatars = uniqueAvatars.size;
        for (const [url, fileName] of uniqueAvatars) {
            try {
                await this.downloadFile(url, avatarDir, fileName);
                downloaded++;
                logger.debug(`头像下载成功: ${fileName}`);
                
                // 更新进度 (头像下载占总进度的50%)
                const progress = Math.round((downloaded / totalAvatars) * 50);
                logger.progressBar('下载资源', progress, 100);
            } catch (error) {
                logger.error(`头像下载失败 ${fileName}:`, (error as Error).message);
                downloaded++;
                
                // 即使失败也要更新进度
                const progress = Math.round((downloaded / totalAvatars) * 50);
                logger.progressBar('下载资源', progress, 100);
            }
        }

        logger.debug(`头像下载完成: ${downloaded}/${uniqueAvatars.size} 成功`);
    }

    async downloadPageResources(pageData: ParsedPageData): Promise<void> {
        const resources: Array<[string, string]> = [];
        
        // 收集所有需要下载的资源
        if (pageData.resourceUrls && pageData.resourceUrls.length > 0) {
            for (const resourceUrl of pageData.resourceUrls) {
                const fileName = this.getFileName(resourceUrl);
                resources.push([resourceUrl, fileName]);
            }
        }

        if (resources.length === 0) {
            logger.debug('没有找到需要下载的页面资源');
            return;
        }

        logger.debug(`开始下载 ${resources.length} 个页面资源...`);

        // 创建图片和GIF目录
        const imageDir = join(this.outputDir, CONFIG.imageDir);
        const gifDir = join(this.outputDir, CONFIG.gifDir);
        await Promise.all([
            ensureDir(imageDir),
            ensureDir(gifDir)
        ]);

        let downloaded = 0;
        const totalResources = resources.length;
        for (const [url, fileName] of resources) {
            try {
                const isGif = fileName.toLowerCase().endsWith('.gif');
                const targetDir = isGif ? gifDir : imageDir;
                await this.downloadFile(url, targetDir, fileName);
                downloaded++;
                logger.debug(`页面资源下载成功: ${fileName}`);
                
                // 更新进度 (页面资源下载占总进度的50%，从50%开始)
                const progress = 50 + Math.round((downloaded / totalResources) * 50);
                logger.progressBar('下载资源', progress, 100);
            } catch (error) {
                logger.error(`页面资源下载失败 ${fileName}:`, (error as Error).message);
                downloaded++;
                
                // 即使失败也要更新进度
                const progress = 50 + Math.round((downloaded / totalResources) * 50);
                logger.progressBar('下载资源', progress, 100);
            }
        }

        logger.debug(`页面资源下载完成: ${downloaded}/${resources.length} 成功`);
    }

    /**
     * 下载单个文件
     */
    private async downloadFile(url: string, targetDir: string, fileName: string): Promise<void> {
        const filePath = join(targetDir, fileName);
        
        try {
            const response = await fetch(url, {
                headers: createHeaders(this.token, this.url, this.sessionId)
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            if (!response.body) {
                throw new Error('响应体为空');
            }

            // 使用流式下载避免内存占用过大
            const fileStream = createWriteStream(filePath);
            await pipeline(response.body as any, fileStream);
            
        } catch (error) {
            throw new Error(`下载失败: ${(error as Error).message}`);
        }
    }

    /**
     * 从URL中提取文件名
     */
    private getFileName(url: string): string {
        try {
            const urlObj = new URL(url);
            const pathname = urlObj.pathname;
            const fileName = pathname.split('/').pop() || 'unknown';
            
            // 如果文件名没有扩展名，根据URL特征添加
            if (!fileName.includes('.')) {
                if (url.includes('gif') || url.toLowerCase().includes('.gif')) {
                    return `${fileName}.gif`;
                } else {
                    return `${fileName}.png`;
                }
            }
            
            return fileName;
        } catch (error) {
            // 如果URL解析失败，生成一个基于时间戳的文件名
            const timestamp = Date.now();
            const isGif = url.toLowerCase().includes('gif');
            return `resource_${timestamp}.${isGif ? 'gif' : 'png'}`;
        }
    }

    /**
     * 获取已下载的头像路径映射
     */
    async getAvatarPaths(commentData: Comment[]): Promise<Map<string, string>> {
        const avatarPaths = new Map<string, string>();
        const avatarDir = join(this.outputDir, CONFIG.avatarDir);

        commentData.forEach(comment => {
            if (comment.userInfo?.profileImageUrl) {
                const userId = comment.user_id;
                const avatarPath = join(avatarDir, `${userId}.jpg`);
                avatarPaths.set(userId, avatarPath);
            }
        });

        return avatarPaths;
    }
}