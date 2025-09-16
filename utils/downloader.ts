// 下载器模块 - 处理核心下载逻辑
import * as cheerio from 'cheerio';
import { join } from 'path';
import { Comment, CommentData, PageData, LiveData, Resource, EnrichedComment, DownloadResult } from './types.js';
import { CONFIG } from './config.js';
import { AssGenerator } from './ass-generator.js';
import { UserInfoManager } from './user-info.js';
import { 
    delay, 
    retry, 
    getResourceFilename, 
    ensureDir, 
    saveJson,
    createHeaders,
    createJsonHeaders,
    logger 
} from './utils.js';

export class ZanLiveDownloader {
    private token: string;
    private url: string;
    private liveId: string | null = null;
    private liveName: string | null = null;
    private commentData: CommentData[] = [];
    private resourceUrls: Set<string> = new Set();
    private downloadedResources: Set<string> = new Set();
    private userInfoManager: UserInfoManager | null = null;

    constructor(token: string, url: string) {
        this.token = token;
        this.url = url;
        
        // 初始化用户信息管理器
        this.userInfoManager = new UserInfoManager(token, url);
    }

    /**
     * 获取直播ID
     */
    getLiveId(): string | null {
        return this.liveId;
    }

    /**
     * 获取直播名称
     */
    getLiveName(): string | null {
        return this.liveName;
    }

    /**
     * 获取页面内容
     * @returns 页面HTML字符串
     */
    async fetchPage(): Promise<string> {
        logger.info(`正在获取页面: ${this.url}`);
        
        try {
            const response = await fetch(this.url, {
                headers: createHeaders(this.token, this.url)
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const html = await response.text();
            return html;
        } catch (error) {
            logger.error('获取页面失败:', (error as Error).message);
            throw error;
        }
    }

    // 解析页面信息
    parsePage(html: string): PageData {
        const $ = cheerio.load(html);
        
        // 获取基本信息
        this.liveId = $('meta[name="live-id"]').attr('content') || null;
        this.liveName = $('meta[name="live-name"]').attr('content') || null;
        
        if (!this.liveId) {
            throw new Error('未找到有效的直播ID，请确认URL是否正确');
        }

        logger.info(`检测到直播: ${this.liveName} (ID: ${this.liveId})`);

        // 解析礼物数据
        this.parseGiftData($);
        
        // 解析背景图片
        this.parseBackgroundImages($);
        
        // 解析横幅图片
        this.parseBannerImages($);

        logger.info(`总共发现 ${this.resourceUrls.size} 个资源URL`);

        return {
            commentWsUrl: $('meta[name="comment-ws-url"]').attr('content') || undefined,
            commentPull: $('meta[name="comment-pull"]').attr('content') || undefined,
            vodCommentManifestUrl: $('meta[name="vod-comment-manifest-url"]').attr('content') || undefined,
            apiEndpointUrl: $('meta[name="api-endpoint-url"]').attr('content') || undefined
        };
    }

    // 解析礼物数据
    parseGiftData($: cheerio.CheerioAPI): void {
        const normalGifts = $('meta[name="normalGifts"]').attr('content');
        if (normalGifts) {
            try {
                const gifts = JSON.parse(normalGifts);
                gifts.forEach((gift: any) => {
                    if (gift.iconUrl) this.resourceUrls.add(gift.iconUrl);
                    if (gift.commentIconUrl) this.resourceUrls.add(gift.commentIconUrl);
                    if (gift.listIconUrl) this.resourceUrls.add(gift.listIconUrl);
                });
                logger.info(`发现 ${gifts.length} 个礼物图标`);
            } catch (e: unknown) {
                const error = e as Error;
                logger.warn('解析礼物数据失败:', error.message);
            }
        }
    }

    // 解析背景图片
    parseBackgroundImages($: cheerio.CheerioAPI): void {
        const bgImageUrl = $('meta[name="design-backGroundImageURL"]').attr('content');
        if (bgImageUrl) this.resourceUrls.add(bgImageUrl);

        const titleImageUrl = $('meta[name="design-titleImageURL"]').attr('content');
        if (titleImageUrl) this.resourceUrls.add(titleImageUrl);

        const tapToStartImage = $('meta[name="design-taptostartImage"]').attr('content');
        if (tapToStartImage) this.resourceUrls.add(tapToStartImage);
    }

    // 解析横幅图片
    parseBannerImages($: cheerio.CheerioAPI): void {
        const liveBanners = $('meta[name="live-banners"]').attr('content');
        if (liveBanners) {
            try {
                const banners = JSON.parse(liveBanners);
                banners.forEach((banner: any) => {
                    if (banner.bannerImageURL) this.resourceUrls.add(banner.bannerImageURL);
                    if (banner.bannerOverImageURL) this.resourceUrls.add(banner.bannerOverImageURL);
                });
            } catch (e: unknown) {
                const error = e as Error;
                logger.warn('解析横幅数据失败:', error.message);
            }
        }
    }

    // 获取评论数据
    async fetchComments(pageData: PageData): Promise<CommentData[]> {
        logger.info('开始获取评论数据...');

        // // 获取初始评论数据
        // if (pageData.commentPull) {
        //     await this.fetchInitialComments(pageData.commentPull);
        // }

        // 获取VOD评论数据
        if (pageData.vodCommentManifestUrl) {
            await this.fetchVodComments(pageData.vodCommentManifestUrl);
        }

        logger.success(`评论数据获取完成，共 ${this.commentData.length} 条`);
        return this.commentData;
    }

    // 获取初始评论数据
    async fetchInitialComments(commentPullUrl: string): Promise<void> {
        try {
            const url = commentPullUrl + '&limit=1000';
            logger.info('获取初始评论数据:', url);

            const response = await fetch(url, {
                headers: createJsonHeaders(this.token, this.url)
            });

            if (response.ok) {
                const data = await response.json();
                if (data && data.comments) {
                    data.comments.forEach((comment: any) => {
                        this.commentData.push({
                            timestamp: new Date().toISOString(),
                            source: 'initial_pull',
                            data: comment
                        });
                    });
                    logger.info(`从初始API获取到 ${data.comments.length} 条评论`);
                }
            }
        } catch (error: unknown) {
            const err = error as Error;
            logger.warn('获取初始评论失败:', err.message);
        }
    }

    // 获取VOD评论数据
    async fetchVodComments(manifestUrl: string): Promise<void> {
        try {
            logger.info('获取VOD评论清单:', manifestUrl);

            const response = await fetch(manifestUrl, {
                headers: createHeaders(this.token, this.url)
            });

            if (response.ok) {
                const manifest = await response.json();
                if (manifest && manifest.comments) {
                    const commentUrls = Object.keys(manifest.comments);
                    logger.info(`发现 ${commentUrls.length} 个评论片段`);
                    
                    await this.fetchCommentSegments(commentUrls, manifest.comments);
                }
            } else {
                logger.warn(`获取VOD评论清单失败 (HTTP ${response.status}): ${manifestUrl}`);
            }
        } catch (error: unknown) {
            const err = error as Error;
            logger.warn('获取VOD评论失败:', err.message);
        }
    }

    // 获取评论片段
    async fetchCommentSegments(commentUrls: string[], commentsManifest: Record<string, [number, number]>): Promise<void> {
        for (let i = 0; i < commentUrls.length; i++) {
            const commentUrl = commentUrls[i];
            if (!commentUrl) continue;
            
            const timeRange = commentsManifest[commentUrl];
            if (!timeRange) continue;
            
            try {
                logger.progress(i + 1, commentUrls.length, `获取评论片段: ${commentUrl}`);
                logger.info(`时间范围: ${timeRange[0]} - ${timeRange[1]}`);
                
                const segmentResponse = await fetch(commentUrl, {
                    headers: createHeaders(this.token, this.url)
                });
                
                if (segmentResponse.ok) {
                    const segmentData = await segmentResponse.json();
                    this.processCommentSegment(segmentData, commentUrl, timeRange);
                } else {
                    logger.warn(`获取评论片段失败 (HTTP ${segmentResponse.status}): ${commentUrl}`);
                }
            } catch (e: unknown) {
                const err = e as Error;
                logger.warn(`获取评论片段失败: ${commentUrl}`, err.message);
            }
            
            // 添加小延迟避免请求过快
            await delay(CONFIG.delays.commentSegment);
        }
    }

    // 处理评论片段数据
    processCommentSegment(segmentData: any, commentUrl: string, timeRange: [number, number]): void {
        if (segmentData && Array.isArray(segmentData)) {
            // VOD评论数据通常是数组格式
            segmentData.forEach((comment: any) => {
                this.commentData.push({
                    timestamp: new Date().toISOString(),
                    source: 'vod_segment',
                    segment: commentUrl,
                    timeRange: [new Date(timeRange[0]).toISOString(), new Date(timeRange[1]).toISOString()],
                    data: comment
                } as CommentData);
            });
            logger.info(`从片段获取到 ${segmentData.length} 条评论`);
        } else if (segmentData && segmentData.comments) {
            // 如果数据包装在comments字段中
            segmentData.comments.forEach((comment: any) => {
                this.commentData.push({
                    timestamp: new Date().toISOString(),
                    source: 'vod_segment',
                    segment: commentUrl,
                    timeRange: [new Date(timeRange[0]).toISOString(), new Date(timeRange[1]).toISOString()],
                    data: comment
                } as CommentData);
            });
            logger.info(`从片段获取到 ${segmentData.comments.length} 条评论`);
        }
    }

    // 下载资源文件
    async downloadResources(): Promise<void> {
        if (this.resourceUrls.size === 0) {
            logger.info('没有发现资源文件');
            return;
        }

        logger.info(`开始下载 ${this.resourceUrls.size} 个资源文件...`);
        
        const resourceArray = Array.from(this.resourceUrls);
        let successCount = 0;
        let failCount = 0;

        for (let i = 0; i < resourceArray.length; i++) {
            const url = resourceArray[i];
            if (!url) continue;
            
            try {
                await retry(() => this.downloadResource(url));
                successCount++;
                logger.progress(i + 1, resourceArray.length, `资源下载 (成功: ${successCount}, 失败: ${failCount})`);
            } catch (error: unknown) {
                const err = error as Error;
                failCount++;
                logger.warn(`下载失败 ${url}:`, err.message);
            }
        }

        logger.success(`资源下载完成: 成功 ${successCount} 个, 失败 ${failCount} 个`);
    }

    // 下载单个资源
    async downloadResource(url: string): Promise<void> {
        const filename = getResourceFilename(url);
        
        // 生成直播目录名称
        const liveDirectoryName = this.generateLiveDirectoryName();
        const filepath = join(liveDirectoryName, CONFIG.imageDir, filename);
        
        // 检查是否已下载
        if (this.downloadedResources.has(url)) {
            return;
        }

        // 确保目录存在
        await ensureDir(join(liveDirectoryName, CONFIG.imageDir));

        const response = await fetch(url, {
            headers: {
                'User-Agent': CONFIG.userAgent,
                'Referer': this.url
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const buffer = await response.arrayBuffer();
        await require('fs').promises.writeFile(filepath, Buffer.from(buffer));
        
        this.downloadedResources.add(url);
    }

    // 生成ASS弹幕文件
    async generateAssFile(): Promise<void> {
        try {
            logger.info('🎬 开始生成ASS弹幕文件...');
            
            if (!this.liveId || !this.liveName) {
                throw new Error('缺少直播ID或直播名称');
            }
            
            const assGenerator = new AssGenerator(this.liveId, this.liveName);
            // 将CommentData转换为EnrichedComment
            const enrichedComments: EnrichedComment[] = this.commentData.map(comment => ({
                id: comment.data.id,
                user_id: comment.data.user_id,
                content: comment.data.content,
                message: comment.data.content?.text || (comment.data.content?.gift ? `[礼物: ${comment.data.content.gift}]` : ''),
                type: comment.data.type,
                is_hide: comment.data.is_hide,
                created_at: comment.data.created_at,
                admin_name: comment.data.admin_name,
                admin_image: comment.data.admin_image,
                userInfo: comment.data.userInfo,
                timestamp: new Date(comment.data.created_at).getTime(),
                user: {
                    id: comment.data.user_id,
                    nickname: comment.data.userInfo?.userName,
                    userName: comment.data.userInfo?.userName,
                    avatar: comment.data.userInfo?.profileImageUrl,
                    profileImageUrl: comment.data.userInfo?.profileImageUrl
                },
                enriched: true,
                avatarPath: undefined
            }));
            
            // 生成直播目录名称并传递给saveAss
            const liveDirectoryName = this.generateLiveDirectoryName();
            await assGenerator.saveAss(enrichedComments, liveDirectoryName);
            
            logger.success('✅ ASS弹幕文件生成完成');
        } catch (error: unknown) {
            const err = error as Error;
            logger.error('❌ 生成ASS弹幕文件失败:', err.message);
        }
    }

    // 生成直播目录名称
    private generateLiveDirectoryName(): string {
        if (this.liveName) {
            // 清理直播名称中的非法字符
            const sanitizedName = this.liveName.replace(/[<>:"/\\|?*]/g, '_');
            return sanitizedName;
        } else {
            // 如果没有直播名称，使用zan_live_加时间戳格式
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            return `zan_live_${timestamp}`;
        }
    }

    // 保存评论数据
    async saveComments(): Promise<void> {
        if (this.commentData.length === 0) {
            logger.info('没有评论数据可保存');
            return;
        }

        if (!this.liveId) {
            throw new Error('缺少直播ID');
        }

        // 生成直播目录名称
        const liveDirectoryName = this.generateLiveDirectoryName();
        
        // 评论JSON保存在直播目录内
        const filename = join(liveDirectoryName, `${this.liveId}_comments.json`);
        
        const content = {
            liveId: this.liveId,
            liveName: this.liveName,
            downloadTime: new Date().toISOString(),
            totalComments: this.commentData.length,
            totalUsers: this.userInfoManager?.getUserInfoCache().size || 0,
            downloadedAvatars: this.userInfoManager?.getDownloadedAvatars().size || 0,
            comments: this.commentData
        };

        await saveJson(content, filename);
        logger.success(`评论数据已保存到: ${filename}`);
    }

    // 执行下载
    async download(): Promise<DownloadResult> {
        try {
            logger.info('下载器启动');
            logger.info(`Token: ${this.token.substring(0, 10)}...`);
            logger.info(`URL: ${this.url}`);

            // 获取页面
            const html = await this.fetchPage();
            const pageData = this.parsePage(html);
            
            // 获取评论数据
            await this.fetchComments(pageData);
            
            // 处理用户信息和头像下载
            if (this.userInfoManager) {
                // 将CommentData转换为Comment数组
                const comments = this.commentData.map(cd => cd.data);
                await this.userInfoManager.processUserData(comments);
                
                // 合并用户信息到评论数据
                const enrichedComments = this.userInfoManager.enrichCommentsWithUserInfo(comments);
                
                // 更新commentData中的data字段
                this.commentData.forEach((cd, index) => {
                    if (enrichedComments[index]) {
                        cd.data = enrichedComments[index];
                    }
                });
            }
            
            // 保存评论数据
            await this.saveComments();
            
            // 生成ASS弹幕文件
            await this.generateAssFile();
            
            // 下载资源文件
            await this.downloadResources();
            
            logger.success('\n下载完成！');
            logger.info(`评论数据: ${this.commentData.length} 条`);
            logger.info(`用户信息: ${this.userInfoManager?.getUserInfoCache().size || 0} 个`);
            logger.info(`用户头像: ${this.userInfoManager?.getDownloadedAvatars().size || 0} 个`);
            logger.info(`资源文件: ${this.downloadedResources.size} 个`);
            
            return {
                success: true,
                message: '下载完成',
                data: {
                    liveId: this.liveId,
                    liveName: this.liveName,
                    totalComments: this.commentData.length,
                    totalUsers: this.userInfoManager?.getUserInfoCache().size || 0,
                    downloadedAvatars: this.userInfoManager?.getDownloadedAvatars().size || 0,
                    downloadedResources: this.downloadedResources.size
                }
            };
            
        } catch (error: unknown) {
            const err = error as Error;
            logger.error('下载失败:', err.message);
            return {
                success: false,
                message: err.message
            };
        }
    }
}