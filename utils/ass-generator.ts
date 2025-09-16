import { Comment } from './types.js';
import fs from 'fs';
import path from 'path';
import { CONFIG, getDanmakuHeight, getMaxDanmakuLines } from './config.js';
import { logger } from './utils.js';

export class AssGenerator {
    private videoWidth: number;
    private videoHeight: number;
    private danmakuHeight: number;
    private fontSize: number;
    private speed: number;
    private lineHeight: number;
    private maxLines: number;
    private liveId: string;
    private liveName: string;
    private displayAreaRatio: number; // 字幕显示区域比例（从顶部开始）
    private lineSpacing: number; // 行间距（相对于字符大小的倍数）

    constructor(
        liveId: string, 
        liveName: string = '直播',
        displayAreaRatio: number = 0.25, // 默认上1/4区域
        lineSpacing: number = 0.7 // 默认0.7个字符大小的行间距
    ) {
        this.liveId = liveId;
        this.liveName = liveName;
        this.videoWidth = 1920;
        this.videoHeight = 1080;
        this.fontSize = 24;
        this.speed = 8;
        this.displayAreaRatio = displayAreaRatio;
        this.lineSpacing = lineSpacing;
        
        // 重新计算行高：基础字体大小 + 行间距
        this.lineHeight = this.fontSize + (this.fontSize * this.lineSpacing);
        
        // 计算在指定区域内可容纳的最大行数
        const displayAreaHeight = this.videoHeight * this.displayAreaRatio;
        this.maxLines = Math.floor(displayAreaHeight / this.lineHeight);
        
        // 确保至少有1行
        if (this.maxLines < 1) {
            this.maxLines = 1;
        }
        
        // 弹幕高度设为行高，保持兼容性
        this.danmakuHeight = this.lineHeight;
    }

    /**
     * 生成ASS头部信息
     */
    generateHeader(): string {
        let header = `[Script Info]
Title: ${this.liveName}
ScriptType: v4.00+
PlayResX: ${this.videoWidth}
PlayResY: ${this.videoHeight}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Danmaku,@Microsoft YaHei,${this.fontSize},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,10,1
Style: Fallback,@SimHei,${this.fontSize},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text

`;
        return header;
    }

    /**
     * 时间戳转换为ASS时间格式
     */
    timeToAss(timestamp: number): string {
        // 将时间戳转换为相对于第一条评论的时间
        const totalCentiseconds = Math.floor(timestamp / 10);
        const hours = Math.floor(totalCentiseconds / 360000);
        const minutes = Math.floor((totalCentiseconds % 360000) / 6000);
        const seconds = Math.floor((totalCentiseconds % 6000) / 100);
        const centiseconds = totalCentiseconds % 100;
        
        return `${hours.toString().padStart(1, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${centiseconds.toString().padStart(2, '0')}`;
    }

    /**
     * 生成弹幕动画效果
     */
    generateDanmakuAnimation(startX: number, endX: number, y: number): string {
        return `{\\move(${startX},${y},${endX},${y})}`;
    }

    /**
     * 生成弹幕文本内容
     */
    generateDanmakuText(comment: Comment, line: number): string {
        // 计算Y坐标，确保弹幕只在上1/4区域显示
        const y = line * this.lineHeight + this.lineHeight / 2;
        const startX = this.videoWidth + 100;
        
        const message = comment.content?.text || '';
        
        // 计算文本宽度和动画
        const textWidth = message.length * this.fontSize * 0.6;
        const totalWidth = textWidth + 20;
        const endX = -totalWidth - 100;
        
        const animation = this.generateDanmakuAnimation(startX, endX, y);
        
        return `${animation}${message}`;
    }

    /**
     * 生成ASS弹幕事件
     */
    async generateEvents(comments: Comment[]): Promise<string> {
        let events = '';
        const lineTracker: number[] = new Array(this.maxLines).fill(0);
        
        // 获取第一条评论的时间作为基准时间
        const firstCommentTime = comments.length > 0 ? new Date(comments[0]?.created_at || 0).getTime() : 0;
        
        comments.forEach((comment) => {
            const message = comment.content?.text;
            if (!message) return;
            
            // 计算相对时间（毫秒）
            const currentTime = new Date(comment.created_at).getTime() - firstCommentTime;
            const startTime = this.timeToAss(currentTime);
            const endTime = this.timeToAss(currentTime + this.speed * 1000);
            
            // 改进的防重叠机制：选择可用的弹幕行
            let selectedLine = 0;
            let foundAvailableLine = false;
            
            // 首先尝试找到完全空闲的行
            for (let i = 0; i < this.maxLines; i++) {
                if ((lineTracker[i] || 0) <= currentTime) {
                    selectedLine = i;
                    foundAvailableLine = true;
                    break;
                }
            }
            
            // 如果没有完全空闲的行，选择最早结束的行
            if (!foundAvailableLine) {
                let earliestEndTime = lineTracker[0] || 0;
                selectedLine = 0;
                for (let i = 1; i < this.maxLines; i++) {
                    const currentLineEndTime = lineTracker[i] || 0;
                    if (currentLineEndTime < earliestEndTime) {
                        earliestEndTime = currentLineEndTime;
                        selectedLine = i;
                    }
                }
            }
            
            // 更新行占用时间，确保弹幕不重叠
            const danmakuDuration = this.speed * 1000;
            lineTracker[selectedLine] = Math.max(currentTime, lineTracker[selectedLine] || 0) + danmakuDuration;
            
            const danmakuText = this.generateDanmakuText(comment, selectedLine);
            events += `Dialogue: 0,${startTime},${endTime},Danmaku,,0,0,0,,${danmakuText}\n`;
        });
        
        return events;
    }

    /**
     * 生成ASS字幕内容
     */
    async generateAss(comments: Comment[]): Promise<string> {
        const header = await this.generateHeader();
        const events = await this.generateEvents(comments);
        return header + events;
    }

    /**
     * 保存ASS文件
     */
    async saveAss(comments: Comment[], liveDirectoryName?: string): Promise<string> {
        try {
            // 初始化进度条
            logger.progressBar('生成ASS弹幕文件', 0, 100);
            
            // 确定输出目录
            let outputDir: string;
            if (liveDirectoryName) {
                outputDir = liveDirectoryName;
            } else {
                if (this.liveName && this.liveName !== '直播') {
                    const sanitizedName = this.liveName.replace(/[<>:"/\\|?*]/g, '_');
                    outputDir = sanitizedName;
                } else {
                    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                    outputDir = `zan_live_${timestamp}`;
                }
            }
            
            // 更新进度：目录准备完成
            logger.progressBar('生成ASS弹幕文件', 20, 100);
            
            // 创建ASS目录
            const assDir = path.join(outputDir, 'ass');
            if (!fs.existsSync(assDir)) {
                fs.mkdirSync(assDir, { recursive: true });
            }
            
            // 更新进度：目录创建完成
            logger.progressBar('生成ASS弹幕文件', 30, 100);
            
            // 生成并保存ASS内容
            const assContent = await this.generateAss(comments);
            
            // 更新进度：ASS内容生成完成
            logger.progressBar('生成ASS弹幕文件', 80, 100);
            
            // 使用直播名作为文件名，而不是时间戳
            let filename: string;
            if (this.liveName && this.liveName !== '直播') {
                const sanitizedName = this.liveName.replace(/[<>:"/\\|?*]/g, '_');
                filename = `${sanitizedName}.ass`;
            } else {
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                filename = `danmaku_${timestamp}.ass`;
            }
            
            const filepath = path.join(assDir, filename);
            
            // 更新进度：文件名准备完成
            logger.progressBar('生成ASS弹幕文件', 90, 100);
            
            fs.writeFileSync(filepath, assContent, 'utf-8');
            
            // 完成进度
            logger.progressBar('生成ASS弹幕文件', 100, 100);
            
            logger.info(`ASS字幕文件已保存: ${filepath}`);
            return filepath;
        } catch (error) {
            logger.error('保存ASS文件失败:', error);
            throw error;
        }
    }
}