import { existsSync, promises as fs } from 'fs';
import { join } from 'path';
import { UserInfo, Comment } from './types.js';
import { CONFIG } from './config.js';
import { 
    delay, 
    retry, 
    createJsonHeaders,
    logger 
} from './utils.js';

export class UserInfoManager {
    private token: string;
    private apiEndpoint: string;
    private baseUrl: string;
    private userInfoCache: Map<string, UserInfo>;
    private downloadedAvatars: Set<string>;

    constructor(token: string, apiEndpoint: string, baseUrl: string = '') {
        this.token = token;
        this.apiEndpoint = apiEndpoint;
        this.baseUrl = baseUrl;
        this.userInfoCache = new Map();
        this.downloadedAvatars = new Set();
    }

    /**
     * 获取用户信息
     * @param userId 用户ID
     * @returns 用户信息对象
     */
    async getUserInfo(userId: string): Promise<UserInfo | null> {
        try {
            // 构建用户信息API URL
            const apiUrl = `https://api.zan-live.com/api/user/${userId}`;
            
            const response = await fetch(apiUrl, {
                headers: createJsonHeaders(this.token, apiUrl)
            });

            if (response.ok) {
                const userInfo = await response.json();
                
                // 缓存用户信息
                this.userInfoCache.set(userId, userInfo);
                
                return userInfo;
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
     * 下载用户头像
     * @param userId 用户ID
     * @param avatarUrl 头像URL
     * @returns 头像本地路径
     */
    async downloadUserAvatar(userId: string, avatarUrl: string): Promise<string | null> {
        if (!avatarUrl) {
            return null;
        }
        
        try {
            const filename = `${userId}.jpg`;
            const avatarPath = join(CONFIG.avatarDir, filename);
            
            // 检查文件是否已存在
            if (existsSync(avatarPath)) {
                return avatarPath;
            }
            
            const response = await fetch(avatarUrl, {
                headers: {
                    'User-Agent': CONFIG.userAgent,
                    'Referer': this.baseUrl
                }
            });
            
            if (!response.ok) {
                return null;
            }
            
            const buffer = await response.arrayBuffer();
            await fs.writeFile(avatarPath, new Uint8Array(buffer));
            
            logger.info(`下载用户头像成功: ${filename}`);
            return avatarPath;
            
        } catch (error: unknown) {
            logger.warn(`下载用户头像失败 ${userId}:`, (error as Error).message);
            return null;
        }
    }

    /**
     * 处理用户数据，获取用户信息并下载头像
     */
    async processUserData(comments: Comment[]): Promise<void> {
        logger.info('开始处理用户信息...');
        
        let successCount = 0;
        let failCount = 0;

        for (const comment of comments) {
            if (!comment.user_id) continue;
            
            const userId = comment.user_id;
            
            try {
                const userInfo = await retry(() => this.getUserInfo(userId));
                
                if (userInfo) {
                    successCount++;
                    
                    // 下载用户头像
                    if (userInfo.profileImageUrl) {
                        await retry(() => this.downloadUserAvatar(userId, userInfo.profileImageUrl!));
                    }
                } else {
                    failCount++;
                }
                
                // 延迟以避免请求过于频繁
                await delay(CONFIG.delays.userInfo);
                
            } catch (error: unknown) {
                failCount++;
                logger.warn(`处理用户信息失败 ${userId}:`, (error as Error).message);
            }
        }
        
        logger.info(`用户信息处理完成 - 成功: ${successCount}, 失败: ${failCount}`);
    }

    // 合并用户信息到评论数据
    enrichCommentsWithUserInfo(commentData: Comment[]): Comment[] {
        logger.info('正在合并用户信息到评论数据...');
        
        let enrichedCount = 0;
        
        const enrichedComments = commentData.map(comment => {
            if (comment.user_id) {
                const userId = comment.user_id;
                const userInfo = this.userInfoCache.get(userId);
                
                if (userInfo) {
                    enrichedCount++;
                    return {
                        ...comment,
                        userInfo: userInfo
                    };
                }
            }
            return comment;
        });
        
        logger.success(`已为 ${enrichedCount} 条评论添加用户信息`);
        return enrichedComments;
    }

    // 获取用户信息缓存
    getUserInfoCache() {
        return this.userInfoCache;
    }

    // 获取已下载头像集合
    getDownloadedAvatars() {
        return this.downloadedAvatars;
    }
}