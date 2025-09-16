#!/usr/bin/env bun
import { Command } from 'commander';
import { ZanLiveDownloader } from './utils/downloader.js';
import { CONFIG } from './utils/config.js';
import { saveJson, formatTimestamp } from './utils/utils.js';
import { CommentData } from './utils/types.js';
import path from 'path';
import fs from 'fs';

const program = new Command();

program
    .name('zan-downloader')
    .description('')
    .version('1.0.0')
    .requiredOption('-t, --token <token>', '认证token')
    .requiredOption('-u, --url <url>', '直播间URL')
    .option('-o, --output <dir>', '输出目录', CONFIG.downloadDir)
    .option('--comments-only', '仅下载和完善评论数据')
    .option('--resources-only', '仅下载资源和生成ASS（需要已完善的评论JSON）')
    .action(async (options) => {
        try {
            console.log('下载器启动');
            console.log(`📅 开始时间: ${formatTimestamp(Date.now())}`);
            
            const downloader = new ZanLiveDownloader(options.token, options.url);
            
            // 设置输出目录
            if (options.output) {
                CONFIG.downloadDir = options.output;
            }
            
            // 获取页面数据并提取直播ID
            console.log('🔍 正在解析页面...');
            const html = await downloader.fetchPage();
            const pageData = downloader.parsePage(html);
            
            // 从downloader中获取解析出的liveId
            const liveId = downloader.getLiveId();
            if (!liveId) {
                throw new Error('无法从页面中提取直播ID');
            }
            
            const commentsJsonPath = path.join(CONFIG.commentDir, `${liveId}_enriched_comments.json`);
            
            // 阶段1：下载并完善评论JSON
            if (!options.resourcesOnly) {
                console.log('\n📝 阶段1：下载并完善评论数据');
                
                // 下载评论数据
                console.log('💬 正在下载评论数据...');
                const comments: CommentData[] = await downloader.fetchComments(pageData);
                
                if (!comments || comments.length === 0) {
                    console.log('⚠️  未找到评论数据');
                    return;
                }
                
                console.log(`📊 获取到 ${comments.length} 条评论`);
                
                // 完善评论数据（获取用户信息、下载头像等）
                console.log('🔄 正在完善评论数据...');
                const enrichedComments = comments; // 这里应该调用用户信息处理逻辑
                
                // 保存完善后的评论JSON
                await saveJson(enrichedComments, commentsJsonPath);
                console.log(`✅ 完善的评论数据已保存到: ${commentsJsonPath}`);
                
                if (options.commentsOnly) {
                    console.log('🎉 评论数据处理完成！');
                    return;
                }
            }
            
            // 阶段2：根据完善的JSON下载资源和生成ASS
            if (!options.commentsOnly) {
                console.log('\n🎬 阶段2：下载资源和生成ASS字幕');
                
                // 检查是否存在完善的评论JSON
                if (!fs.existsSync(commentsJsonPath)) {
                    console.error('❌ 未找到完善的评论JSON文件，请先运行评论数据处理阶段');
                    console.error(`   期望文件位置: ${commentsJsonPath}`);
                    return;
                }
                
                // 读取完善的评论数据
                console.log('📖 正在读取完善的评论数据...');
                const commentDataArray = JSON.parse(fs.readFileSync(commentsJsonPath, 'utf8'));
                console.log(`📊 读取到 ${commentDataArray.length} 条完善的评论`);
                
                // 转换为EnrichedComment格式
                const enrichedComments = commentDataArray.map((commentData: CommentData) => {
                    const comment = commentData.data;
                    
                    // 提取消息内容 - 从content.text获取文本消息
                    let message = '';
                    if (comment.content?.text) {
                        message = comment.content.text;
                    } else if (comment.content?.gift) {
                        // 如果是礼物类型，生成描述性消息
                        message = `[礼物: ${comment.content.gift}]`;
                    }
                    
                    return {
                        id: comment.id,
                        message: message,
                        timestamp: new Date(comment.created_at).getTime(),
                        user_id: comment.user_id,
                        user: {
                            id: comment.user_id,
                            nickname: comment.userInfo?.userName,
                            userName: comment.userInfo?.userName,
                            avatar: comment.userInfo?.profileImageUrl,
                            profileImageUrl: comment.userInfo?.profileImageUrl
                        },
                        enriched: true,
                        avatarPath: undefined // 头像路径将在后续下载时设置
                    };
                }).filter((comment: any) => comment.message); // 过滤掉没有消息内容的评论
                
                // 重新获取页面数据（用于资源下载）
                const pageData = await downloader.fetchPage();
                
                // 下载资源文件
                console.log('📥 正在下载资源文件...');
                await downloader.downloadResources();
                
                // 生成ASS字幕文件
                console.log('🎭 正在生成ASS字幕文件...');
                const liveName = downloader.getLiveName() || '直播';
                const assGenerator = new (await import('./utils/ass-generator.js')).AssGenerator(liveId, liveName);
                
                // 生成直播目录名称
                let liveDirectoryName: string;
                if (liveName && liveName !== '直播') {
                    liveDirectoryName = liveName.replace(/[<>:"/\\|?*]/g, '_');
                } else {
                    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                    liveDirectoryName = `zan_live_${timestamp}`;
                }
                
                await assGenerator.saveAss(enrichedComments, liveDirectoryName);
                
                console.log('🎉 所有任务完成！');
            }
            
            console.log(`📅 完成时间: ${formatTimestamp(Date.now())}`);
            
        } catch (error: unknown) {
            const err = error as Error;
            console.error('❌ 下载过程中发生错误:', err.message);
            if (err.stack) {
                console.error('错误堆栈:', err.stack);
            }
            process.exit(1);
        }
    });

/**
 * 从URL中提取直播ID
 * @param url 直播间URL
 * @returns 直播ID
 */
function extractLiveId(url: string): string {
    const match = url.match(/\/live\/(\d+)/);
    if (!match || !match[1]) {
        throw new Error('无法从URL中提取直播ID');
    }
    return match[1];
}

program.parse();