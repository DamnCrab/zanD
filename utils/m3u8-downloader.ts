// M3U8流下载器模块 - 使用@renmu/m3u8-downloader下载视频流
import * as fs from 'fs';
import * as path from 'path';
import M3U8Downloader from '@renmu/m3u8-downloader';
import { logger } from './utils.js';

export interface M3U8DownloadOptions {
    url: string;
    outputDir: string;
    filename: string;
    streamIndex?: number; // 流索引，默认为0（第一条流）
    refererUrl?: string; // Referer请求头，用于认证
    token?: string; // JWT token，用于Cookie认证
    sessionId?: string; // 会话ID，用于Z-aN_sid Cookie
    concurrency?: number; // 并发下载数，默认为5
    retries?: number; // 重试次数，默认为3
}

export interface M3U8Stream {
    bandwidth: number;
    frameRate?: number;
    displayName?: string;
    url: string;
}

export class M3U8StreamDownloader {
    private outputDir: string;
    private cacheDir: string;

    constructor(outputDir: string) {
        this.outputDir = outputDir;
        this.cacheDir = path.join(outputDir, 'cache');
    }

    /**
     * 解析M3U8主播放列表，获取所有可用流
     */
    async parseM3U8Streams(url: string): Promise<M3U8Stream[]> {
        try {
            logger.debug(`解析M3U8主播放列表: ${url}`);
            
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const content = await response.text();
            const lines = content.split('\n').map(line => line.trim()).filter(line => line);
            
            const streams: M3U8Stream[] = [];
            let currentStreamInfo: Partial<M3U8Stream> = {};
            
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (!line) continue;
                
                if (line.startsWith('#EXT-X-STREAM-INF:')) {
                    // 解析流信息
                    const attributes = this.parseAttributes(line);
                    const bandwidth = parseInt(attributes.BANDWIDTH || '0') || 0;
                    const frameRate = attributes['FRAME-RATE'] ? parseFloat(attributes['FRAME-RATE']) : undefined;
                    
                    currentStreamInfo = {
                        bandwidth,
                        frameRate
                    };
                    
                    // 生成显示名称
                    const resolution = attributes.RESOLUTION;
                    if (resolution) {
                        const height = resolution.split('x')[1];
                        currentStreamInfo.displayName = frameRate ? `${height}p${Math.round(frameRate)}` : `${height}p`;
                    } else {
                        currentStreamInfo.displayName = `${Math.round(bandwidth / 1000)}kbps`;
                    }
                } else if (line && !line.startsWith('#') && currentStreamInfo.bandwidth) {
                    // 这是流的URL
                    currentStreamInfo.url = line;
                    streams.push(currentStreamInfo as M3U8Stream);
                    currentStreamInfo = {};
                }
            }
            
            // 按带宽排序（从高到低）
            streams.sort((a, b) => b.bandwidth - a.bandwidth);
            
            logger.debug(`发现 ${streams.length} 个可用流:`);
            streams.forEach((stream, index) => {
                logger.debug(`  [${index}] ${stream.displayName} - ${stream.bandwidth}bps${stream.frameRate ? ` @${stream.frameRate}fps` : ''}`);
            });
            
            return streams;
        } catch (error) {
            logger.error('解析M3U8流失败:', error);
            throw error;
        }
    }

    /**
     * 下载指定的M3U8流
     */
    async downloadStream(options: M3U8DownloadOptions): Promise<string | null> {
        try {
            logger.debug(`开始下载M3U8流: ${options.url}`);
            
            // 确保输出目录存在
            if (!fs.existsSync(options.outputDir)) {
                fs.mkdirSync(options.outputDir, { recursive: true });
            }
            
            // 清理文件名
            const cleanFilename = this.cleanFilename(options.filename);
            const outputPath = path.join(options.outputDir, `${cleanFilename}.mp4`);
            
            logger.debug(`输出路径: ${outputPath}`);
            
            // 构建请求头
            const headers: Record<string, string> = {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            };
            
            if (options.refererUrl) {
                headers['Referer'] = options.refererUrl;
            }
            
            // 构建Cookie
            const cookies = [];
            if (options.token) {
                cookies.push(`nglives_pltk=${options.token}`);
            }
            if (options.sessionId) {
                cookies.push(`Z-aN_sid=${options.sessionId}`);
            }
            if (cookies.length > 0) {
                headers['Cookie'] = cookies.join('; ');
            }
            
            // 创建下载器实例
            const downloader = new M3U8Downloader(options.url, outputPath, {
                concurrency: options.concurrency || 5,
                retries: options.retries || 3,
                headers: headers,
                segmentsDir: this.cacheDir,
                convert2Mp4: true,
                clean: true
            });
            
            // 设置事件监听
            let lastProgress = 0;
            downloader.on('progress', (progress) => {
                const percent = Math.round((progress.downloaded / progress.total) * 100);
                if (percent !== lastProgress) {
                    logger.info(`M3U8下载: ${percent}% [${'='.repeat(Math.floor(percent / 5))}${' '.repeat(20 - Math.floor(percent / 5))}]`);
                    lastProgress = percent;
                }
            });
            
            downloader.on('error', (error: any) => {
                logger.error('M3U8下载过程中发生错误:', error?.message || String(error));
            });
            
            // 开始下载
            await downloader.download();
            
            // 检查输出文件是否存在
            if (fs.existsSync(outputPath)) {
                logger.info('M3U8流下载完成');
                return outputPath;
            } else {
                throw new Error('下载完成但未找到输出文件');
            }
            
        } catch (error) {
            logger.error('M3U8流下载失败');
            logger.debug('错误详情:', error);
            return null;
        }
    }

    /**
     * 下载第一个可用流（最高质量）
     */
    async downloadFirstStream(options: M3U8DownloadOptions): Promise<string | null> {
        try {
            const streams = await this.parseM3U8Streams(options.url);
            
            if (streams.length === 0) {
                throw new Error('未找到可用的M3U8流');
            }
            
            // 选择指定索引的流，默认为0（最高质量）
            const streamIndex = options.streamIndex ?? 0;
            if (streamIndex >= streams.length) {
                throw new Error(`流索引 ${streamIndex} 超出范围，可用流数量: ${streams.length}`);
            }
            
            const selectedStream = streams[streamIndex];
            if (!selectedStream) {
                throw new Error(`无法获取流索引 ${streamIndex} 的流信息`);
            }
            
            logger.info(`选择流 [${streamIndex}]: ${selectedStream.displayName} - ${selectedStream.bandwidth}bps${selectedStream.frameRate ? ` @${selectedStream.frameRate}fps` : ''}`);
            
            // 构建完整的M3U8 URL
            let fullM3U8Url = selectedStream.url;
            if (!fullM3U8Url.startsWith('http')) {
                // 如果是相对路径，需要基于原始URL构建完整URL
                const baseUrl = new URL(options.url);
                fullM3U8Url = new URL(selectedStream.url, baseUrl.origin + baseUrl.pathname.replace(/\/[^\/]*$/, '/')).href;
            }
            
            logger.debug(`使用完整M3U8 URL: ${fullM3U8Url}`);
            
            // 下载选定的流
            return await this.downloadStream({
                ...options,
                url: fullM3U8Url
            });
            
        } catch (error) {
            logger.error('下载第一个流失败:', error);
            return null;
        }
    }

    /**
     * 解析属性字符串
     */
    private parseAttributes(line: string): Record<string, string> {
        const attributes: Record<string, string> = {};
        const attributeRegex = /([A-Z-]+)=([^,]+)/g;
        let match;
        
        while ((match = attributeRegex.exec(line)) !== null) {
            const key = match[1];
            let value = match[2];
            
            if (!key || !value) continue;
            
            // 移除引号
            if (value.startsWith('"') && value.endsWith('"')) {
                value = value.slice(1, -1);
            }
            
            attributes[key] = value;
        }
        
        return attributes;
    }

    /**
     * 清理文件名，移除不安全字符
     */
    private cleanFilename(filename: string): string {
        return filename
            .replace(/[<>:"/\\|?*]/g, '_')
            .replace(/\s+/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_|_$/g, '');
    }
}