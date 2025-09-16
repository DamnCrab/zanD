import fs from 'fs';
import path from 'path';
import { Config } from './types.js';

// 配置模块 - 管理所有配置项
export const CONFIG: Config = {
    // 目录配置
    downloadDir: 'dist/',
    commentDir: 'comments/',
    imageDir: 'images/',
    gifDir: 'gifs/',
    avatarDir: 'avatars/',
    assDir: 'ass/',
    
    // 网络配置
    maxRetries: 3,
    retryDelay: 1000,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    
    // ASS弹幕配置
    ass: {
        videoWidth: 1920,
        videoHeight: 1080,
        fontSize: 24,
        speed: 8, // 弹幕移动速度（秒）
        lineHeight: 60,
        avatarSize: 48
    },
    
    // 请求延迟配置
    delays: {
        commentSegment: 100, // 评论片段请求间隔
        userInfo: 200, // 用户信息请求间隔
        resource: 50 // 资源下载间隔
    }
};

// 获取完整的文件路径
export function getFilePath(baseDir: string, subDir: string, filename: string): string {
    return join(baseDir, subDir, filename);
}

// 获取ASS弹幕区域高度
export function getDanmakuHeight(): number {
    return Math.floor(CONFIG.ass.videoHeight / 4);
}

// 获取最大弹幕行数
export function getMaxDanmakuLines(): number {
    return Math.floor(getDanmakuHeight() / CONFIG.ass.lineHeight);
}

// 导入path模块用于路径处理
import { join } from 'path';