// TypeScript类型定义文件

export interface Config {
    downloadDir: string;
    commentDir: string;
    imageDir: string;
    gifDir: string;
    avatarDir: string;
    assDir: string;
    maxRetries: number;
    retryDelay: number;
    userAgent: string;
    requestDelay?: number;
    ass: {
        videoWidth: number;
        videoHeight: number;
        fontSize: number;
        speed: number;
        lineHeight: number;
        avatarSize: number;
    };
    delays: {
        commentSegment: number;
        userInfo: number;
        resource: number;
    };
}

export interface UserInfo {
    id: string;
    nickname?: string;
    userName?: string;
    avatar?: string;
    profileImageUrl?: string;
    level?: number;
    badges?: string[];
}

export interface Comment {
    id: string;
    user_id: string;
    content?: {
        gift?: number;
        text?: string;
    };
    type: number;
    is_hide: number;
    created_at: string;
    admin_name?: string | null;
    admin_image?: string | null;
    userInfo?: {
        userName?: string;
        profileImageUrl?: string;
    };
}

export interface CommentData {
    timestamp: string;
    source: string;
    segment?: string;
    timeRange?: [string, string]; // 实际数据中是字符串格式的时间戳
    data: Comment;
}

export interface Resource {
    id: string;
    name: string;
    url: string;
    type: 'gift' | 'gift_animation' | 'background' | 'banner';
}

export interface LiveData {
    live?: {
        id: string;
        title?: string;
        background?: string;
    };
    gift?: {
        giftList?: Array<{
            id: string;
            name: string;
            image?: string;
            animation?: string;
        }>;
    };
    banner?: Array<{
        title?: string;
        image?: string;
    }>;
}

export interface PageData {
    commentWsUrl?: string;
    commentPull?: string;
    vodCommentManifestUrl?: string;
    apiEndpointUrl?: string;
}

export interface EnrichedComment extends Comment {
    user: UserInfo;
    enriched: boolean;
    avatarPath?: string;
    timestamp?: number; // 添加timestamp字段用于ASS生成
    message?: string; // 添加message字段用于ASS生成
}

export interface DownloadResult {
    success: boolean;
    message: string;
    data?: any;
}

export interface AssConfig {
    videoWidth: number;
    videoHeight: number;
    fontSize: number;
    speed: number;
    lineHeight: number;
    maxLines: number;
}