# YouTube Creator Anybox Plugin

这是一个基于 YouTube Data API v3 与 YouTube Analytics API 的 Anybox 创作者插件。初始版本提供：

- Google OAuth 2.0 授权和 Refresh Token 自动刷新；
- 频道资料、订阅数、累计播放量和视频数量读取；
- 最近上传视频、单视频元数据、状态与统计数据读取；
- 本地视频可续传分片上传；
- 受 `confirm=true` 保护的视频元数据与隐私状态更新；
- 受破坏性标记和 `confirm=true` 双重保护的视频永久删除；
- 观看时长、互动、订阅变化、流量来源、观众画像和可选收益报表。

本插件不是 Google 或 YouTube 官方产品，也不代表其认可或背书。

## 接入准备

1. 在 Google Cloud Console 创建项目。
2. 启用 YouTube Data API v3 和 YouTube Analytics API。
3. 配置 OAuth 同意屏幕，并创建“Web application”类型的 OAuth Client。
4. 注册回调地址：

   ```text
   http://localhost:1455/auth/callback
   ```

5. 在插件连接表单中填写 Client ID 与 Client Secret。不要把真实密钥写入仓库、README 或聊天正文。

完整初始版本请求：

```text
https://www.googleapis.com/auth/youtube.force-ssl
https://www.googleapis.com/auth/yt-analytics.readonly
https://www.googleapis.com/auth/yt-analytics-monetary.readonly
```

公开提供给其他用户前，Google OAuth 敏感权限通常需要验证。YouTube API 项目的合规审核与 Google OAuth 应用验证是不同流程。

## 视频上传与审核限制

插件使用 YouTube 官方 resumable upload 协议，每个数据块为 8 MiB，遇到可恢复的中断会查询服务端已接收位置后续传。

未经审核、且在 2020 年 7 月 28 日以后创建的 API 项目，其 `videos.insert` 上传可能被强制限制为私密状态。插件不能绕过这一限制；正式公开上传前需要按 YouTube 要求完成合规审核。

建议首次联调始终使用：

```text
privacy_status=private
notify_subscribers=false
```

上传、修改都要求 `confirm=true`。永久删除还会被 MCP 标记为 destructive，并在 Server 内再次核对确认值。

## Analytics 边界

- 默认报表截止到昨天，以减少数据延迟造成的空值。
- 初始版本把单次查询限制在 366 天以内。
- 观众画像可能因隐私阈值而缺少行。
- 收益指标需要频道具备相应资格，并成功授予 monetary scope；即使授权成功，也不保证每个频道都有收益数据。
- `youtube_video_list` 每页最多返回 50 个视频，不能把一页结果描述为完整频道历史。

## 主要工具

读取：

- `youtube_test_auth`
- `youtube_channel_get`
- `youtube_dashboard_summary`
- `youtube_video_categories`
- `youtube_video_list`
- `youtube_video_get`
- `youtube_analytics_summary`
- `youtube_traffic_sources`
- `youtube_audience_demographics`

写入：

- `youtube_video_upload`
- `youtube_video_update`
- `youtube_video_delete`

## 初始版本边界

暂不包含：

- 后台跨进程上传任务和进度 UI；
- 字幕、缩略图、播放列表和评论管理；
- YouTube Reporting API 的每日批量报表下载；
- 定时自动采集和长期本地指标仓库；
- Content Owner / CMS 多频道代理操作。

这些能力适合在 OAuth 验证、配额和真实频道联调通过后继续迭代。
