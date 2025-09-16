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
    userName?: string;
    profileImageUrl?: string;
}

export interface CommentOrigin {
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
}

export interface Comment extends CommentOrigin{
    userInfo?: userInfo
}

export interface userInfo{
    userName?: string;
    profileImageUrl?: string;
}

export interface PageData {
    commentWsUrl?: string;
    commentPull?: string;
    vodCommentManifestUrl?: string;
    apiEndpointUrl?: string;
}
