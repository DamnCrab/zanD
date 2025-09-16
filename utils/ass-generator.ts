import { AssConfig, EnrichedComment } from './types.js';
import fs from 'fs';
import path from 'path';
import { CONFIG, getDanmakuHeight, getMaxDanmakuLines } from './config.js';
import { ImageProcessor } from './image-processor.js';

export class AssGenerator {
    private videoWidth: number;
    private videoHeight: number;
    private danmakuHeight: number;
    private avatarSize: number;
    private fontSize: number;
    private speed: number;
    private lineHeight: number;
    private maxLines: number;
    private liveId: string;
    private liveName: string;
    private tempDir: string;
    private processedAvatars: Map<string, string> = new Map();

    constructor(liveId: string, liveName: string = '直播') {
        this.liveId = liveId;
        this.liveName = liveName;
        this.videoWidth = 1920;
        this.videoHeight = 1080;
        this.fontSize = 24;
        this.speed = 8;
        this.avatarSize = 32;
        this.danmakuHeight = getDanmakuHeight();
        this.lineHeight = this.danmakuHeight + 5;
        this.maxLines = getMaxDanmakuLines();
        this.tempDir = path.join(CONFIG.downloadDir, 'temp');
    }

    /**
     * 生成ASS头部信息，包含Graphics部分
     */
    generateHeader(): string {
        let header = `[Script Info]
Title: ${this.liveName}
ScriptType: v4.00+
PlayResX: ${this.videoWidth}
PlayResY: ${this.videoHeight}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Danmaku,Arial,${this.fontSize},&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1

`;

        // 添加Graphics部分
        if (this.processedAvatars.size > 0) {
            header += '[Graphics]\n';
            for (const [originalPath, processedPath] of this.processedAvatars) {
                const fileName = path.basename(processedPath);
                const base64Data = ImageProcessor.imageToBase64(processedPath);
                header += `filename: ${fileName}\n`;
                header += `${base64Data}\n`;
            }
            header += '\n';
        }

        header += `[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text

`;
        return header;
    }

    // 时间戳转换为ASS时间格式
    timeToAss(timestamp: number): string {
        const date = new Date(timestamp);
        const hours = date.getUTCHours().toString().padStart(2, '0');
        const minutes = date.getUTCMinutes().toString().padStart(2, '0');
        const seconds = date.getUTCSeconds().toString().padStart(2, '0');
        const centiseconds = Math.floor(date.getUTCMilliseconds() / 10).toString().padStart(2, '0');
        return `${hours}:${minutes}:${seconds}.${centiseconds}`;
    }

    // 生成弹幕动画效果
    generateDanmakuAnimation(startX: number, endX: number, y: number, duration: number): string {
        return `{\\move(${startX},${y},${endX},${y})}`;
    }

    // 处理头像和文本组合
    generateDanmakuText(comment: EnrichedComment, avatarFileName: string | null, line: number): string {
        const y = line * this.lineHeight + this.lineHeight / 2;
        const startX = this.videoWidth + 100; // 从右侧开始
        
        // 获取用户名 - 优先使用userName，如果没有则不显示发送人
        const userName = comment.user?.userName || comment.userInfo?.userName;
        const message = comment.message || '';
        
        // 构建显示文本
        let displayText = '';
        if (avatarFileName) {
            // 使用{\img()}标签显示头像
            displayText += `{\\img(${avatarFileName})}`;
        }
        
        if (userName) {
            displayText += `${userName}: ${message}`;
        } else {
            displayText += message;
        }
        
        // 计算文本宽度
        const textWidth = displayText.length * this.fontSize * 0.6;
        const totalWidth = textWidth + 20;
        const endX = -totalWidth - 100;
        
        const animation = this.generateDanmakuAnimation(startX, endX, y, this.speed);
        
        return `${animation}${displayText}`;
    }

    // 生成ASS弹幕事件
    async generateEvents(comments: EnrichedComment[]): Promise<string> {
        let events = '';
        const lineTracker: number[] = new Array(this.maxLines).fill(0);
        
        // 收集所有头像路径
        const avatarPaths = comments
            .map(comment => comment.avatarPath)
            .filter((path): path is string => !!path && ImageProcessor.isValidImage(path));
        
        // 批量处理头像
        if (avatarPaths.length > 0) {
            this.processedAvatars = await ImageProcessor.processAvatarBatch(
                avatarPaths, 
                this.tempDir, 
                this.avatarSize
            );
        }
        
        comments.forEach((comment, index) => {
            if (!comment.message) return;
            
            const currentTime = comment.timestamp || 0;
            const startTime = this.timeToAss(currentTime);
            const endTime = this.timeToAss(currentTime + this.speed * 1000);
            
            // 选择可用的弹幕行
            let selectedLine = 0;
            for (let i = 0; i < this.maxLines; i++) {
                if ((lineTracker[i] || 0) <= currentTime) {
                    selectedLine = i;
                    break;
                }
            }
            
            // 更新行跟踪器
            lineTracker[selectedLine] = currentTime + this.speed * 1000;
            
            // 获取处理后的头像文件名
            let avatarFileName: string | null = null;
            if (comment.avatarPath && this.processedAvatars.has(comment.avatarPath)) {
                const processedPath = this.processedAvatars.get(comment.avatarPath)!;
                avatarFileName = path.basename(processedPath);
            }
            
            // 生成弹幕文本
            const danmakuText = this.generateDanmakuText(comment, avatarFileName, selectedLine);
            
            // 添加Dialogue事件
            events += `Dialogue: 0,${startTime},${endTime},Danmaku,,0,0,0,,${danmakuText}\n`;
        });
        
        return events;
    }

    /**
     * 生成ASS字幕内容
     * @param comments 评论数据数组
     * @returns ASS字幕内容字符串
     */
    async generateAss(comments: EnrichedComment[]): Promise<string> {
        const header = await this.generateHeader();
        const events = await this.generateEvents(comments);
        return header + events;
    }

    async saveAss(comments: EnrichedComment[], liveDirectoryName?: string): Promise<string> {
        try {
            // 生成直播目录名称（如果没有提供）
            let outputDir: string;
            if (liveDirectoryName) {
                outputDir = liveDirectoryName;
            } else {
                // 如果没有提供直播目录名称，使用默认逻辑
                if (this.liveName && this.liveName !== '直播') {
                    const sanitizedName = this.liveName.replace(/[<>:"/\\|?*]/g, '_');
                    outputDir = sanitizedName;
                } else {
                    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                    outputDir = `zan_live_${timestamp}`;
                }
            }
            
            // 创建ASS子目录
            const assDir = path.join(outputDir, 'ass');
            if (!fs.existsSync(assDir)) {
                fs.mkdirSync(assDir, { recursive: true });
            }
            
            // 生成ASS内容
            const assContent = await this.generateAss(comments);
            
            // 生成文件名
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `danmaku_${timestamp}.ass`;
            const filepath = path.join(assDir, filename);
            
            // 写入文件
            fs.writeFileSync(filepath, assContent, 'utf-8');
            
            // 清理临时文件
            await ImageProcessor.cleanupTempFiles(this.tempDir);
            
            console.log(`ASS字幕文件已保存: ${filepath}`);
            return filepath;
        } catch (error) {
            console.error('保存ASS文件失败:', error);
            throw error;
        }
    }
}