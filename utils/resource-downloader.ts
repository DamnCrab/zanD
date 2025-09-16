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

export class ResourceDownloader {
    private token: string;
    private url: string;
    private outputDir: string;

    constructor(token: string, url: string, outputDir: string) {
        this.token = token;
        this.url = url;
        this.outputDir = outputDir;
    }

    /**
     * 下载所有资源
     */
    async downloadAllResources(commentData: Comment[], pageData: ParsedPageData): Promise<void> {
        logger.info('开始下载资源...');

        // 并行下载头像和页面资源
        await Promise.all([
            this.downloadAvatars(commentData),
            this.downloadPageResources(pageData)
        ]);

        logger.success('所有资源下载完成');
    }

    /**
     * 从评论数据中下载用户头像
     */
    async downloadAvatars(commentData: Comment[]): Promise<void> {
        logger.info('开始下载用户头像...');

        // 创建头像目录
        const avatarDir = join(this.outputDir, CONFIG.avatarDir);
        await ensureDir(avatarDir);

        // 提取唯一的头像URL
        const avatarUrls = new Map<string, string>();
        commentData.forEach(comment => {
            if (comment.userInfo?.profileImageUrl) {
                const userId = comment.user_id;
                const avatarUrl = comment.userInfo.profileImageUrl;
                if (!avatarUrls.has(userId)) {
                    avatarUrls.set(userId, avatarUrl);
                }
            }
        });

        if (avatarUrls.size === 0) {
            logger.warn('未找到需要下载的头像');
            return;
        }

        logger.info(`发现 ${avatarUrls.size} 个唯一头像需要下载`);

        // 批量下载头像
        const downloadPromises = Array.from(avatarUrls.entries()).map(async ([userId, avatarUrl], index) => {
            try {
                // 添加延迟避免请求过于频繁
                if (index > 0) {
                    await delay(CONFIG.delays.resource);
                }

                logger.progress(index + 1, avatarUrls.size, `下载头像: ${userId}`);
                await this.downloadFile(avatarUrl, avatarDir, `${userId}.jpg`);
                return { userId, success: true };
            } catch (error) {
                logger.warn(`下载头像失败 ${userId}:`, (error as Error).message);
                return { userId, success: false, error };
            }
        });

        const results = await Promise.allSettled(downloadPromises);
        const successCount = results.filter(result => 
            result.status === 'fulfilled' && result.value.success
        ).length;

        logger.success(`头像下载完成: ${successCount}/${avatarUrls.size} 成功`);
    }

    /**
     * 从页面数据中下载图片和GIF资源
     */
    async downloadPageResources(pageData: ParsedPageData): Promise<void> {
        logger.info('开始下载页面资源...');

        if (!pageData.resourceUrls || pageData.resourceUrls.length === 0) {
            logger.warn('未找到需要下载的页面资源');
            return;
        }

        // 创建图片和GIF目录
        const imageDir = join(this.outputDir, CONFIG.imageDir);
        const gifDir = join(this.outputDir, CONFIG.gifDir);
        await Promise.all([
            ensureDir(imageDir),
            ensureDir(gifDir)
        ]);

        logger.info(`发现 ${pageData.resourceUrls.length} 个资源需要下载`);

        // 分类和下载资源
        const downloadPromises = pageData.resourceUrls.map(async (resourceUrl: string, index: number) => {
            try {
                // 添加延迟避免请求过于频繁
                if (index > 0) {
                    await delay(CONFIG.delays.resource);
                }

                logger.progress(index + 1, pageData.resourceUrls.length, `下载资源: ${this.getFileName(resourceUrl)}`);
                
                // 根据文件扩展名决定保存目录
                const fileName = this.getFileName(resourceUrl);
                const isGif = fileName.toLowerCase().endsWith('.gif');
                const targetDir = isGif ? gifDir : imageDir;
                
                await this.downloadFile(resourceUrl, targetDir, fileName);
                return { url: resourceUrl, success: true, type: isGif ? 'gif' : 'image' };
            } catch (error) {
                logger.warn(`下载资源失败 ${resourceUrl}:`, (error as Error).message);
                return { url: resourceUrl, success: false, error };
            }
        });

        const results = await Promise.allSettled(downloadPromises);
        const successResults = results.filter((result): result is PromiseFulfilledResult<{url: string, success: true, type: string}> => 
            result.status === 'fulfilled' && result.value.success
        ).map(result => result.value);

        const imageCount = successResults.filter(r => r.type === 'image').length;
        const gifCount = successResults.filter(r => r.type === 'gif').length;

        logger.success(`页面资源下载完成: ${imageCount} 张图片, ${gifCount} 个GIF`);
    }

    /**
     * 下载单个文件
     */
    private async downloadFile(url: string, targetDir: string, fileName: string): Promise<void> {
        const filePath = join(targetDir, fileName);
        
        try {
            const response = await fetch(url, {
                headers: createHeaders(this.token, this.url)
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