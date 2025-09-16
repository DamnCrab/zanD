# Z-aN Live 下载器

一个用于下载Z-aN直播网站评论弹幕数据和相关资源的Bun.js CLI工具。

## 功能特性

- **评论弹幕数据下载**: 自动获取直播间的评论和弹幕数据
- **用户信息获取**: 根据评论中的user_id获取用户详细信息
- **用户头像下载**: 自动下载用户头像到单独的avatars文件夹
- **资源文件下载**: 下载礼物图标、背景图片、横幅等静态资源
- **文件分类存储**: 按类型自动分类保存下载的文件
- **多数据源支持**: 支持WebSocket实时评论、API拉取评论、VOD评论等
- **自动资源识别**: 智能识别页面中的图片和GIF资源
- **Cookie认证**: 使用nglives_pltk token进行身份验证
- **数据合并**: 将用户信息合并到评论JSON数据中
- **ASS弹幕生成**: 生成可用于视频播放器的ASS弹幕文件

## 安装方法

1. 确保已安装 [Bun.js](https://bun.sh/)
2. 克隆或下载项目文件
3. 在项目目录中运行：
   ```bash
   bun install
   ```

## 使用方法

### 命令行参数

```bash
bun run index.js -t <token> -u <url>
```

**参数说明：**
- `-t, --token <token>`: 必需，nglives_pltk cookie值
- `-u, --url <url>`: 必需，Z-aN直播页面URL

### 使用示例

```bash
# 下载指定直播的数据
bun run index.js -t "your_token_here" -u "https://live.zan-live.com/zh-CN/live/12345"

# 查看帮助信息
bun run index.js --help
```

### 获取Token

1. 打开Z-aN直播网站并登录
2. 按F12打开开发者工具
3. 切换到Application/存储 -> Cookies
4. 找到`nglives_pltk`的值，复制作为token参数使用

## 文件结构

下载完成后，文件将按以下结构保存：

```
dist/
├── comments/           # 评论弹幕数据
│   └── {liveId}_{liveName}_comments.json
├── avatars/           # 用户头像
│   ├── {userId}.png
│   └── {userId}.jpg
├── ass/               # ASS弹幕文件
│   └── {liveId}_{liveName}_danmaku.ass
├── images/            # 静态图片资源
│   └── *.png
└── gifs/              # GIF动画资源
    └── *.gif
```

## 数据格式

### 评论JSON格式
```json
{
  "liveId": "3486",
  "liveName": "直播名称",
  "downloadTime": "2025-01-16T10:30:00.000Z",
  "totalComments": 150,
  "totalUsers": 45,
  "downloadedAvatars": 42,
  "comments": [
    {
      "timestamp": "2025-01-16T10:30:00.000Z",
      "source": "vod_segment",
      "data": {
        "user_id": "n6iO.C",
        "message": "评论内容",
        "userInfo": {
          "userName": "用户名",
          "profileImageUrl": "https://storage.zan-live.com/..."
        }
      }
    }
  ]
}
```

### ASS弹幕文件
生成的ASS弹幕文件具有以下特性：
- **从右向左滚动**: 模拟传统弹幕效果
- **占用上1/4屏幕**: 弹幕显示在视频上方区域
- **包含用户信息**: 显示用户名和评论内容
- **时间同步**: 根据评论时间戳精确同步
- **多行显示**: 自动分配弹幕行，避免重叠
- **兼容性强**: 支持大多数视频播放器（如PotPlayer、VLC等）

使用方法：
1. 将生成的ASS文件与视频文件放在同一目录
2. 确保文件名匹配（或手动加载字幕）
3. 在播放器中启用字幕显示
```

## 支持的数据源

1. **WebSocket实时评论**: 通过拦截WebSocket连接获取实时评论
2. **HTTP API评论**: 拦截评论拉取API获取历史评论
3. **VOD存档评论**: 从VOD评论清单文件获取存档评论
4. **页面资源**: 扫描页面中的图片、GIF等资源

## 技术实现

- 使用 `XMLHttpRequest` 和 `WebSocket` 拦截技术捕获数据
- 通过 `GM_download` API 实现文件下载
- 支持多种资源类型的自动识别和分类
- 包含错误处理和重试机制

## 注意事项

- 脚本仅在 Z-aN 直播网站上运行
- 需要 Tampermonkey 扩展支持
- 下载的文件会保存到浏览器默认下载目录
- 请遵守网站使用条款和相关法律法规

## 更新日志

### v1.0
- 初始版本
- 支持评论弹幕数据下载
- 支持图片和GIF资源下载
- 实现文件分类存储功能