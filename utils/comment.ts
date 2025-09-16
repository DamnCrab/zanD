// 下载器模块 - 处理评论获取和用户信息处理
import {join} from 'path';
import { CommentOrigin, PageData, userInfo, UserInfo, Comment} from './types.js';
import {CONFIG} from './config.js';
import {createHeaders, createJsonHeaders, delay, ensureDir, logger, saveJson} from './utils.js';

export class ZanLiveComment {
    private token: string;
    private url: string;
    private liveId: string;
    private liveName: string;
    private commentData: CommentOrigin[] = [];
    private commentDataWithUser: Comment[] = [];

    constructor(token: string, url: string, liveId: string, liveName: string) {
        this.token = token;
        this.url = url;
        this.liveId = liveId;
        this.liveName = liveName;
    }

    /**
     * 获取评论数据并完成所有处理
     */
    async fetchComments(pageData: PageData, outputDir: string): Promise<Comment[]> {
        logger.debug('开始获取评论数据...');
        logger.progressBar('获取评论数据', 0, 100);

        // 获取VOD评论数据
        if (pageData.vodCommentManifestUrl) {
            logger.progressBar('获取评论数据', 10, 100);
            await this.fetchVodComments(pageData.vodCommentManifestUrl);
        }

        if (this.commentData.length === 0) {
            logger.warn('未获取到评论数据');
            logger.progressBar('获取评论数据', 100, 100);
            return [];
        }

        logger.debug(`评论数据获取完成，共 ${this.commentData.length} 条`);
        logger.progressBar('获取评论数据', 50, 100);

        await this.processUserInfo();
        logger.progressBar('获取评论数据', 90, 100);
        
        // 保存完整评论数据
        await this.saveEnriched(outputDir);
        logger.progressBar('获取评论数据', 100, 100);

        return this.commentDataWithUser
    }

    /**
     * 获取VOD评论数据
     */
    private async fetchVodComments(manifestUrl: string): Promise<void> {
        try {
            logger.info('获取VOD评论清单:', manifestUrl);

            const response = await fetch(manifestUrl, {
                headers: createHeaders(this.token, this.url)
            });

            if (response.ok) {
                const manifest = await response.json();
                if (manifest && manifest.comments) {
                    await this.fetchCommentSegments(Object.keys(manifest.comments), manifest.comments);
                }
            } else {
                logger.warn(`获取VOD评论清单失败 (HTTP ${response.status}): ${manifestUrl}`);
            }
        } catch (error: unknown) {
            const err = error as Error;
            logger.warn('获取VOD评论失败:', err.message);
        }
    }

    /**
     * 获取评论片段
     */
    private async fetchCommentSegments(commentUrls: string[], commentsManifest: Record<string, [number, number]>): Promise<void> {
        for (let i = 0; i < commentUrls.length; i++) {
            const commentUrl = commentUrls[i];
            if (!commentUrl) continue;

            const timeRange = commentsManifest[commentUrl];
            if (!timeRange) {
                logger.debug(`未找到时间范围信息: ${commentUrl}`);
                continue;
            }

            try {
                logger.debug(`获取评论片段: ${commentUrl}`);
                logger.debug(`时间范围: ${timeRange[0]} - ${timeRange[1]}`);

                const segmentResponse = await fetch(commentUrl, {
                    headers: createHeaders(this.token, this.url)
                });

                if (segmentResponse.ok) {
                    const segmentData = await segmentResponse.json();
                    this.commentData.push(...segmentData.map((comment: CommentOrigin) => ({
                        ...comment,
                        timeRange
                    })));
                } else {
                    logger.debug(`获取评论片段失败 (HTTP ${segmentResponse.status}): ${commentUrl}`);
                }
            } catch (e: unknown) {
                const err = e as Error;
                logger.debug(`获取评论片段失败: ${commentUrl}`, err.message);
            }

            // 添加延迟避免请求过于频繁
            await delay(CONFIG.delays.commentSegment);
        }
    }

    /**
     * 处理用户信息
     */
    async processUserInfo(){
        logger.debug('开始处理用户信息...');
        
        // 提取唯一用户ID
        const userIds = [...new Set(this.commentData.map(comment => comment.user_id))];
        
        logger.debug(`发现 ${userIds.length} 个唯一用户`);
        
        // 使用Map存储用户信息，提高查找效率
        const userInfoMap = new Map<string, userInfo>();
        
        // 批量获取用户信息，使用Promise.allSettled避免单个失败影响整体
        const userInfoPromises = userIds.map(async (userId, index) => {
            try {
                // 添加延迟避免请求过于频繁
                if (index > 0) {
                    await delay(CONFIG.delays.userInfo);
                }
                
                logger.debug(`获取用户信息: ${userId}`);
                
                const userInfo = await this.fetchUserInfo(userId);
                
                if (userInfo) {
                    userInfoMap.set(userId, userInfo);
                }
                
                // 更新进度 (从50%到90%，根据用户信息获取进度)
                const progress = 50 + Math.round((index + 1) / userIds.length * 40);
                logger.progressBar('获取评论数据', progress, 100);
                
                return { userId, success: true, userInfo };
            } catch (error) {
                logger.debug(`获取用户信息失败: ${userId}`, (error as Error).message);
                return { userId, success: false, error };
            }
        });

        const results = await Promise.allSettled(userInfoPromises);
        const successCount = results.filter(result => 
            result.status === 'fulfilled' && result.value.success
        ).length;
        
        logger.debug(`用户信息获取完成: ${successCount}/${userIds.length} 成功`);
        
        // 将评论数据与用户信息关联，生成完整的评论数据
        this.commentDataWithUser = this.commentData.map(comment => ({
            ...comment,
            userInfo: userInfoMap.get(comment.user_id)
        }));
        
        logger.debug(`用户信息处理完成，共处理 ${this.commentDataWithUser.length} 条评论`);
    }

    /**
     * 获取单个用户信息
     */
    private async fetchUserInfo(userId: string): Promise<UserInfo | null> {
        try {
            const apiUrl = `https://openinfo.zan-live.com/userInfo/${userId}`;

            const response = await fetch(apiUrl, {
                headers: createJsonHeaders(this.token, this.url)
            });

            if (response.ok) {
                return await response.json();
            } else {
                logger.warn(`获取用户信息失败 (HTTP ${response.status}): ${userId}`);
                return null;
            }
        } catch (error: unknown) {
            logger.warn(`获取用户信息失败 ${userId}:`, (error as Error).message);
            return null;
        }
    }

    /**
     * 保存基础和完整评论数据
     */
    async saveEnriched(outputDir: string): Promise<string> {
        const commentsDir = join(outputDir, 'comments');
        await ensureDir(commentsDir);

        // 保存完整评论数据
        const enrichedFilename = join(commentsDir, `${this.liveId}_comments.json`);


        await saveJson(this.commentDataWithUser, enrichedFilename);
        logger.success(`完整评论数据已保存到: ${enrichedFilename}`);
        
        return enrichedFilename;
    }

    async saveCommentData(outputDir: string): Promise<void> {
        try {
            const commentsPath = join(outputDir, 'comments.json');
            await Bun.write(commentsPath, JSON.stringify(this.commentDataWithUser, null, 2));
            logger.debug(`评论数据已保存到: ${commentsPath}`);
        } catch (error) {
            logger.error('保存评论数据失败:', (error as Error).message);
            throw error;
        }
    }
}