# TikTok Creator Anybox Plugin

这是一个基于 TikTok Display API、Login Kit for Desktop 和 Content Posting API 的 Anybox 创作者插件。初始版本提供：

- TikTok Desktop OAuth，包含 Refresh Token 自动刷新；
- 用户资料、公开视频和公开互动计数读取；
- 对有限数量公开视频的播放、点赞、评论和分享汇总；
- 本地 MP4、MOV、WebM 视频分片上传到 TikTok 收件箱草稿；
- 在重新读取创作者身份、隐私选项、互动限制和视频时长上限后的 Direct Post；
- 投稿状态查询和受 `confirm=true` 保护的在途任务取消。

本插件不是 TikTok 官方产品，也不代表 TikTok 对本项目的认可或背书。

## 接入准备

1. 在 TikTok for Developers 创建应用。
2. 添加 Login Kit，并选择 Desktop 集成。
3. 注册静态回调地址：

   ```text
   http://localhost:1455/auth/callback
   ```

4. 添加 Display API 与 Content Posting API。
5. 申请以下 scope：

   ```text
   user.info.basic
   user.info.profile
   user.info.stats
   video.list
   video.upload
   video.publish
   ```

6. 在插件连接表单中填写 Client Key 与 Client Secret。真实 Secret 和 Token 由 Anybox 凭据存储管理，不得提交到源码。

Anybox 为此插件新增了明确的 TikTok Desktop OAuth 方言：授权参数使用 `client_key`，scope 使用逗号分隔，PKCE challenge 使用 TikTok 要求的 SHA-256 十六进制编码；授权码交换、刷新和撤销使用官方表单字段。

## 草稿上传

`tiktok_video_upload_draft` 使用 `video.upload` scope，把视频发送到创作者的 TikTok 收件箱。该调用不会直接发布：用户必须进入 TikTok，点击收件箱通知，继续编辑并确认发布。

草稿上传前必须展示连接账号和文件路径，并取得明确同意。Server 要求 `confirm=true`。

## Direct Post

调用 `tiktok_video_direct_post` 前必须先调用 `tiktok_creator_info`，向用户展示：

- `creator_username` 与昵称；
- 当前可选隐私级别；
- 评论、Duet、Stitch 是否被账号级设置禁用；
- 当前最大视频时长。

标题、话题、提及、隐私、互动选项、封面时间和商业内容声明必须允许用户修改。Direct Post 参数要求传回精确的 `expected_creator_username`、测得的 `duration_seconds` 和 `confirm=true`。Server 会再次读取 creator info；账号或限制变化时会中止并要求重新确认。

媒体传输完成不等于已发布。应使用 `tiktok_publish_status` 跟踪 `PROCESSING_UPLOAD`、`PUBLISH_COMPLETE` 或失败状态；公开内容还可能等待审核后才返回 post ID。

## 审核与限额

未经审核的 Direct Post 客户端受到严格限制，包括：

- 只能向私密账号投稿；
- 只能使用 `SELF_ONLY` 可见性；
- 每日活跃用户、创作者、投稿和待处理分享数量限制。

正式审核还要求应用提供创作者身份展示、可编辑元数据、明确同意、处理进度和最终状态反馈。纯内部上传器或用于把任意第三方内容搬运到 TikTok 的产品可能不符合审核用途要求。

## 数据边界

Display API 主要提供用户资料、公开视频元数据和公开计数。它不是 YouTube Analytics 的等价物；本插件不会声称能够读取 TikTok 观看时长、流量来源、完整观众画像或收益数据。

本插件使用的官方 API 也没有提供修改或删除已发布 TikTok 视频的端点。`tiktok_publish_cancel` 只用于仍可取消的在途 Content Posting 任务，不能删除已发布内容。

## 初始版本边界

暂不包含：

- 公网 Webhook 接收服务；
- 图片轮播投稿；
- `PULL_FROM_URL` 投稿；
- 跨进程上传恢复和进度 UI；
- 已发布视频编辑或删除；
- TikTok Research API 或商业内容分析 API。
