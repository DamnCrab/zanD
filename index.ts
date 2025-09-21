#!/usr/bin/env bun
import {Command} from 'commander';
import {PageParser} from './utils/page-parser.js';
import {ZanLiveComment} from './utils/comment.js';
import {AssGenerator} from './utils/ass-generator.js';
import {ResourceDownloader} from './utils/resource-downloader.js';
import {M3U8StreamDownloader} from './utils/m3u8-downloader.js';
import {ZanLiveAuth} from './utils/auth.js';
import {logger, ensureDir} from './utils/utils.js';

const program = new Command();

program
    .name('zanD')
    .description('Zan Live 直播下载工具')
    .version('1.0.0')
    .option('-t, --token <token>', 'API访问令牌')
    .option('-u, --url <url>', '直播页面URL')
    .option('-s, --session-id <sessionId>', '会话ID (Z-aN_sid Cookie)')
    .option('-e, --email <email>', '登录邮箱')
    .option('-p, --password <password>', '登录密码')
    .option('-o, --output <dir>', '输出目录（默认使用直播名）')
    .option('--no-resources', '跳过评论、资源下载和ASS弹幕生成，仅下载M3U8流')
    .option('--stream-index <index>', '指定下载第几条M3U8流（默认0，即第一条）', '0')
    .option('--debug', '启用调试模式，显示详细信息')
    .parse();

const options = program.opts();

// 设置调试模式
if (options.debug) {
    process.env.DEBUG_MODE = 'true';
}

async function main() {
    const {token, url, sessionId, output, resources, email, password} = options;

    // 检查参数
    if (!url) {
        logger.error('需要提供 url 参数');
        process.exit(1);
    }

    let authToken = token;
    let authSessionId = sessionId;

    // 如果提供了邮箱和密码，则使用登录模式
    if (email && password) {
        logger.info('使用邮箱密码登录模式...');
        const auth = new ZanLiveAuth();
        const loginResult = await auth.login({
            mailAddress: email,
            password: password,
            isPersistentLogin: true
        });

        if (!loginResult.success) {
            logger.error(`登录失败: ${loginResult.error}`);
            process.exit(1);
        }

        authToken = loginResult.token;
        authSessionId = loginResult.sessionId;
        logger.info('登录成功，获取到认证信息');
    } else if (!token) {
        logger.error('需要提供 token 参数或邮箱密码');
        process.exit(1);
    }

    try {
        // 1. 解析页面数据
        logger.debug('步骤 1: 解析页面数据');
        // 使用获取到的认证信息
        const pageParser = new PageParser(authToken, url, authSessionId);
        const pageData = await pageParser.fetchAndParsePage();

        if (!pageData.liveId || !pageData.liveName) {
            throw new Error('无法获取直播ID或直播名称');
        }

        // 只显示直播信息
        console.log(`直播: ${pageData.liveName} (ID: ${pageData.liveId})`);

        // 创建输出目录
        const outputDir = output || pageData.liveName.replace(/[<>:"/\\|?*]/g, '_');
        await ensureDir(outputDir);

        // 2. 获取评论数据并处理用户信息
        if (resources) {
            const commentProcessor = new ZanLiveComment(token, url, pageData.liveId, pageData.liveName, sessionId);
            const commentData = await commentProcessor.fetchComments(pageData, outputDir);

            // 步骤 3: 下载资源
            const resourceDownloader = new ResourceDownloader(token, url, outputDir, sessionId);
            await resourceDownloader.downloadAllResources(commentData, pageData);

            // 4. 生成ASS弹幕文件
            const assGenerator = new AssGenerator(pageData.liveId, pageData.liveName);
            const assFilePath = await assGenerator.saveAss(commentData, outputDir);
            logger.debug(`ASS弹幕文件已生成: ${assFilePath}`);
        }

        // 5. 下载M3U8流
        logger.progressBar('M3U8下载', 0, 100);
        const m3u8Downloader = new M3U8StreamDownloader(outputDir);

        try {
            if (pageData.liveUrl) {
                const streamIndex = parseInt(options.streamIndex, 10);
                const downloadResult = await m3u8Downloader.downloadFirstStream({
                    url: pageData.liveUrl,
                    outputDir: outputDir,
                    filename: pageData.liveName,
                    streamIndex: streamIndex,
                    refererUrl: options.url,
                    token: authToken,
                    sessionId: authSessionId
                });

                if (downloadResult) {
                    logger.progressBar('M3U8下载', 100, 100);
                    logger.debug('M3U8流下载完成');
                } else {
                    logger.error('M3U8流下载失败');
                }
            } else {
                logger.error('M3U8流下载失败: 未找到直播URL');
            }
        } catch (error) {
            logger.error('M3U8流下载失败');
            logger.debug('错误详情:', (error as Error).message);
        }

        logger.debug('所有任务完成！');

    } catch (error) {
        logger.error('处理失败:', (error as Error).message);
        logger.debug('详细错误信息:', error);
        process.exit(1);
    }
}

main().catch(error => {
    logger.error('未处理的错误:', error.message);
    process.exit(1);
});