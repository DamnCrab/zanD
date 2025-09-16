#!/usr/bin/env bun
import { Command } from 'commander';
import { PageParser } from './utils/page-parser.js';
import { logger } from './utils/utils.js';
import { ensureDir } from './utils/utils.js';
import {ZanLiveComment} from "./utils/comment.ts";
import { ResourceDownloader } from './utils/resource-downloader.js';
import { AssGenerator } from './utils/ass-generator.js';
const program = new Command();

program
    .name('zan-downloader')
    .description('Z-aN Live评论弹幕和资源下载CLI工具')
    .version('1.0.0')
    .requiredOption('-t, --token <token>', 'Z-aN JWT认证token')
    .requiredOption('-u, --url <url>', '直播页面URL')
    .option('-o, --output <dir>', '输出目录（默认使用直播名称）')
    .option('--no-comments', '跳过评论下载')
    .option('--no-resources', '跳过资源下载')
    .option('--no-ass', '跳过ASS弹幕生成')
    .parse();

const options = program.opts();

async function main() {
    const { token, url, output, comments, resources } = options;
    const ass = options.ass !== false; // 默认生成ASS，除非明确指定--no-ass
    console.log(options)
    if (!token || !url) {
        logger.error('Token 和 URL 参数不能为空');
        process.exit(1);
    }
    
    try {
        logger.info('开始处理直播数据...');
        
        // 1. 解析页面获取所需数据
        logger.info('步骤 1: 解析页面数据');
        const pageParser = new PageParser(token, url);
        const pageData = await pageParser.fetchAndParsePage();
        
        if (!pageData.liveId || !pageData.liveName) {
            throw new Error('无法获取直播ID或直播名称');
        }
        
        logger.success(`解析完成: ${pageData.liveName} (ID: ${pageData.liveId})`);
        
        // 创建输出目录
        const outputDir = output || pageData.liveName.replace(/[<>:"/\\|?*]/g, '_');
        await ensureDir(outputDir);

        // 2. 获取评论数据并处理用户信息
        let commentData
        if (comments) {
            logger.info('步骤 2: 获取评论数据并处理用户信息');
            const downloader = new ZanLiveComment(token, url, pageData.liveId, pageData.liveName);
            commentData = await downloader.fetchComments(pageData, outputDir);
            
            if (commentData && commentData.length > 0) {
                logger.success(`评论处理完成，共 ${commentData.length} 条评论`);
            } else {
                logger.warn('未获取到评论数据');
            }
        } else {
            logger.info('跳过评论下载（--no-comments）');
        }
        
        // 3. 下载资源
        if (resources && commentData && commentData.length > 0) {
            logger.info('步骤 3: 下载资源文件');
            const resourceDownloader = new ResourceDownloader(token, url, outputDir);
            await resourceDownloader.downloadAllResources(commentData, pageData);
        } else if (!resources) {
            logger.info('跳过资源下载（--no-resources）');
        } else {
            logger.warn('没有评论数据，跳过资源下载');
        }
        
        // 4. 生成ASS弹幕文件
        if (ass && commentData && commentData.length > 0) {
            logger.info('步骤 4: 生成ASS弹幕文件');
            const assGenerator = new AssGenerator(pageData.liveId, pageData.liveName);
            const assFilePath = await assGenerator.saveAss(commentData, outputDir);
            logger.success(`ASS弹幕文件已生成: ${assFilePath}`);
        } else if (!ass) {
            logger.info('跳过ASS弹幕生成（--no-ass）');
        } else {
            logger.warn('没有评论数据，跳过ASS弹幕生成');
        }
        
        logger.success('\n✅ 所有任务完成！');
        
    } catch (error) {
        logger.error(`处理失败: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    }
}

main().catch(error => {
    logger.error(`未处理的错误: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
});