// 页面解析模块 - 处理页面数据解析逻辑
import * as cheerio from 'cheerio';
import { PageData } from './types.js';
import { createHeaders, logger } from './utils.js';

export interface ParsedPageData extends PageData {
    liveId: string;
    liveName: string;
    resourceUrls: string[];
}

export class PageParser {
    private token: string;
    private url: string;

    constructor(token: string, url: string) {
        this.token = token;
        this.url = url;
    }

    /**
     * 获取页面内容
     */
    async fetchPage(): Promise<string> {
        logger.info(`正在获取页面: ${this.url}`);
        
        try {
            const response = await fetch(this.url, {
                headers: createHeaders(this.token, this.url)
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const html = await response.text();
            return html;
        } catch (error) {
            logger.error('获取页面失败:', (error as Error).message);
            throw error;
        }
    }

    /**
     * 解析页面信息，获取所有需要的数据
     */
    parsePage(html: string): ParsedPageData {
        const $ = cheerio.load(html);
        const resourceUrls: string[] = [];
        
        // 获取基本信息
        const liveId = $('meta[name="live-id"]').attr('content');
        const liveName = $('meta[name="live-name"]').attr('content');
        
        if (!liveId) {
            throw new Error('未找到有效的直播ID，请确认URL是否正确');
        }

        // 确保 liveName 不为空
        const safeLiveName = liveName || '直播';
        
        logger.info(`检测到直播: ${safeLiveName} (ID: ${liveId})`);

        // 解析礼物数据
        this.parseGiftData($, resourceUrls);
        
        // 解析背景图片
        this.parseBackgroundImages($, resourceUrls);
        
        // 解析横幅图片
        this.parseBannerImages($, resourceUrls);

        logger.info(`总共发现 ${resourceUrls.length} 个资源URL`);

        return {
            liveId,
            liveName: safeLiveName,
            resourceUrls,
            commentWsUrl: $('meta[name="comment-ws-url"]').attr('content') || undefined,
            commentPull: $('meta[name="comment-pull"]').attr('content') || undefined,
            vodCommentManifestUrl: $('meta[name="vod-comment-manifest-url"]').attr('content') || undefined,
            apiEndpointUrl: $('meta[name="api-endpoint-url"]').attr('content') || undefined
        };
    }

    /**
     * 解析礼物数据
     */
    private parseGiftData($: cheerio.CheerioAPI, resourceUrls: string[]): void {
        const normalGifts = $('meta[name="normalGifts"]').attr('content');
        if (normalGifts) {
            try {
                const gifts = JSON.parse(normalGifts);
                gifts.forEach((gift: any) => {
                    if (gift.iconUrl) resourceUrls.push(gift.iconUrl);
                    if (gift.commentIconUrl) resourceUrls.push(gift.commentIconUrl);
                    if (gift.listIconUrl) resourceUrls.push(gift.listIconUrl);
                });
                logger.info(`发现 ${gifts.length} 个礼物图标`);
            } catch (e: unknown) {
                const error = e as Error;
                logger.warn('解析礼物数据失败:', error.message);
            }
        }
    }

    /**
     * 解析背景图片
     */
    private parseBackgroundImages($: cheerio.CheerioAPI, resourceUrls: string[]): void {
        const bgImageUrl = $('meta[name="design-backGroundImageURL"]').attr('content');
        if (bgImageUrl) resourceUrls.push(bgImageUrl);

        const titleImageUrl = $('meta[name="design-titleImageURL"]').attr('content');
        if (titleImageUrl) resourceUrls.push(titleImageUrl);

        const tapToStartImage = $('meta[name="design-taptostartImage"]').attr('content');
        if (tapToStartImage) resourceUrls.push(tapToStartImage);
    }

    /**
     * 解析横幅图片
     */
    private parseBannerImages($: cheerio.CheerioAPI, resourceUrls: string[]): void {
        const liveBanners = $('meta[name="live-banners"]').attr('content');
        if (liveBanners) {
            try {
                const banners = JSON.parse(liveBanners);
                banners.forEach((banner: any) => {
                    if (banner.bannerImageURL) resourceUrls.push(banner.bannerImageURL);
                    if (banner.bannerOverImageURL) resourceUrls.push(banner.bannerOverImageURL);
                });
            } catch (e: unknown) {
                const error = e as Error;
                logger.warn('解析横幅数据失败:', error.message);
            }
        }
    }

    /**
     * 获取并解析页面数据的便捷方法
     */
    async fetchAndParsePage(): Promise<ParsedPageData> {
        const html = await this.fetchPage();
        return this.parsePage(html);
    }
}