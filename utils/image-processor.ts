import { createCanvas, loadImage, Canvas, CanvasRenderingContext2D } from 'canvas';
import fs from 'fs';
import path from 'path';

export class ImageProcessor {
    /**
     * 处理头像：缩放到指定尺寸，GIF取第一帧，输出到临时目录
     * @param inputPath 输入图片路径
     * @param outputPath 输出图片路径
     * @param size 目标尺寸
     */
    static async processAvatar(inputPath: string, outputPath: string, size: number = 32): Promise<void> {
        try {
            // 确保输出目录存在
            const outputDir = path.dirname(outputPath);
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
            }

            // 加载图片
            const image = await loadImage(inputPath);
            
            // 创建画布
            const canvas = createCanvas(size, size);
            const ctx = canvas.getContext('2d');
            
            // 绘制圆形头像
            ctx.beginPath();
            ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
            ctx.closePath();
            ctx.clip();
            
            // 绘制图片（缩放到合适尺寸）
            ctx.drawImage(image, 0, 0, size, size);
            
            // 保存为PNG
            const buffer = canvas.toBuffer('image/png');
            fs.writeFileSync(outputPath, buffer);
            
        } catch (error) {
            console.error(`处理头像失败 ${inputPath}:`, error);
            throw error;
        }
    }

    /**
     * 批量处理头像
     * @param avatarPaths 头像路径数组
     * @param tempDir 临时目录
     * @param size 目标尺寸
     */
    static async processAvatarBatch(avatarPaths: string[], tempDir: string, size: number = 32): Promise<Map<string, string>> {
        const processedMap = new Map<string, string>();
        
        for (const avatarPath of avatarPaths) {
            if (this.isValidImage(avatarPath)) {
                try {
                    const fileName = path.parse(avatarPath).name + '.png';
                    const outputPath = path.join(tempDir, fileName);
                    
                    await this.processAvatar(avatarPath, outputPath, size);
                    processedMap.set(avatarPath, outputPath);
                } catch (error) {
                    console.warn(`跳过无法处理的头像: ${avatarPath}`, error);
                }
            }
        }
        
        return processedMap;
    }

    /**
     * 检查图片文件是否有效
     * @param imagePath 图片路径
     */
    static isValidImage(imagePath: string): boolean {
        if (!imagePath || !fs.existsSync(imagePath)) {
            return false;
        }
        
        const ext = path.extname(imagePath).toLowerCase();
        return ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'].includes(ext);
    }

    /**
     * 清理临时文件
     * @param tempDir 临时目录
     */
    static cleanupTempFiles(tempDir: string): void {
        try {
            if (fs.existsSync(tempDir)) {
                const files = fs.readdirSync(tempDir);
                for (const file of files) {
                    const filePath = path.join(tempDir, file);
                    fs.unlinkSync(filePath);
                }
                fs.rmdirSync(tempDir);
                console.log(`✅ 已清理临时文件: ${tempDir}`);
            }
        } catch (error) {
            console.warn(`清理临时文件失败: ${tempDir}`, error);
        }
    }

    /**
     * 将图片转换为base64编码（用于Graphics部分）
     * @param imagePath 图片路径
     */
    static imageToBase64(imagePath: string): string {
        try {
            const imageBuffer = fs.readFileSync(imagePath);
            return imageBuffer.toString('base64');
        } catch (error) {
            console.error(`转换图片为base64失败: ${imagePath}`, error);
            throw error;
        }
    }
}