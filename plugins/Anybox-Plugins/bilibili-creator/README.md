# Bilibili Creator Anybox Plugin

这是一个基于[哔哩哔哩开放平台](https://openhome.bilibili.com/doc)的非官方 Anybox 插件。第一版提供：

- OAuth 账号授权与自动刷新；
- 账号、授权范围、粉丝数、关注数和投稿数读取；
- 视频与专栏近 30 天增量数据；
- 视频播放量汇总与单稿件数据查询；
- 本地数值快照，用于计算粉丝变化；
- 视频分片上传、封面上传和稿件提交；
- 专栏图片上传和 HTML 稿件提交；
- 受 `confirm=true` 保护的视频、专栏和本地快照删除。

本插件不是哔哩哔哩官方产品，也不代表哔哩哔哩对本项目的认可或背书。

## 接入前准备

1. 在哔哩哔哩开放平台完成开发者认证并创建应用。
2. 为应用关联需要管理的 UP 主账号。
3. 在应用中配置 OAuth 回调地址：

   ```text
   http://localhost:1455/auth/callback
   ```

4. 为完整的第一版能力申请以下权限：

   ```text
   USER_INFO
   USER_DATA
   ARC_BASE
   ARC_DATA
   ATC_BASE
   ATC_DATA
   ```

5. 准备应用的 `client_id` 与 `client_secret`。不要把它们写入仓库或聊天正文；通过插件连接表单保存。

开放平台应用、权限和关联账号通常需要平台审核。插件无法绕过这些前置条件。

## 安装与连接

从本仓库本地来源安装 `bilibili-creator`，填写：

- `BILIBILI_CLIENT_ID`：开放平台应用 Client ID；
- `BILIBILI_CLIENT_SECRET`：开放平台应用 Client Secret；
- `BILIBILI_API_MODE`：真实使用保持 `production`，接口联调可改为 `sandbox`；
- 两个 Base URL 一般保持默认值。

安装后点击连接，浏览器会打开 B 站授权页。授权成功后先调用 `bilibili_test_auth`，确认返回了所需权限。

## 主要工具

数据与快照：

- `bilibili_account_get`
- `bilibili_dashboard_summary`
- `bilibili_metrics_snapshot`
- `bilibili_metrics_history`
- `bilibili_metrics_clear`

视频：

- `bilibili_video_categories`
- `bilibili_video_list`
- `bilibili_video_get`
- `bilibili_video_stats`
- `bilibili_video_publish`
- `bilibili_video_delete`

专栏：

- `bilibili_article_categories`
- `bilibili_article_list`
- `bilibili_article_get`
- `bilibili_article_stats`
- `bilibili_article_upload_image`
- `bilibili_article_publish`
- `bilibili_article_delete`

## 视频发布约束

- 视频路径和封面路径必须是绝对路径。
- 视频最大 4 GB；不超过 100 MB 时使用单文件上传，超过后按 8 MB 顺序分片。
- 封面只接受 JPEG 或 PNG，最大 5 MB。
- `category_id` 应从 `bilibili_video_categories` 获取。
- 原创稿件使用 `copyright=1`；转载使用 `copyright=2`，并提供 `source`。
- 提交成功只表示进入 B 站审核流程，不表示已经公开。

## 专栏发布约束

`bilibili_article_publish` 接受 B 站兼容 HTML，不会自动把 Markdown 做有损转换。正文可以直接通过 `content_html` 提供，也可以通过绝对路径 `content_path` 读取 UTF-8 HTML 文件，两者必须二选一。

正文图片应先用 `bilibili_article_upload_image` 上传，再把返回 URL 写进 HTML。模板规则：

- `template_id=3`：至少提供三张 `image_urls`；
- `template_id=4`：提供封面图、`banner_url` 或 `top_video_bvid`；
- `template_id=5`：由平台生成默认封面。

## 指标历史与隐私

每次调用 `bilibili_metrics_snapshot`，插件只在本机保存以下数值：时间、粉丝数、关注数、已通过视频数，以及视频和专栏的 30 天增量。不保存 Access Token、Refresh Token、昵称、头像或稿件正文。

默认文件位置：

```text
<Anybox 数据目录>/plugin-data/bilibili-creator/metrics-history.json
```

没有可用的 Anybox 数据目录环境变量时，回退到：

```text
~/.anybox/plugin-data/bilibili-creator/metrics-history.json
```

`bilibili_metrics_clear` 可以永久删除该文件，但必须传入 `confirm=true`。

## 沙盒与第一版边界

`BILIBILI_API_MODE=sandbox` 会把签名 API 切换到开放平台文档中的 `/mock` 路径。原始视频上传域名仍由 `BILIBILI_UPLOAD_BASE_URL` 控制；为避免把沙盒文件误发给生产上传域名，当沙盒模式仍使用默认生产上传域名时，视频发布会被拒绝。测试沙盒发布前，请先按当前开放平台文档填写沙盒上传地址。

第一版暂不包含：

- 公网 Webhook 接收服务；
- 定时发布；
- 跨进程断点续传；
- 视频或专栏编辑；
- Markdown 到 B 站富文本的自动转换。

这些能力适合在 OAuth 和真实账号沙盒联调通过后继续迭代。

## 安全说明

- 所有开放平台请求使用 HMAC-SHA256 签名。
- OAuth Token 由 Anybox 凭据存储管理，不写入插件目录。
- 发布工具不会删除现有内容。
- 删除工具被标记为 destructive，并且在 Server 内再次检查 `confirm=true`。
- 请只发布拥有合法权利或明确授权的内容，并遵守哔哩哔哩开放平台协议与社区规则。
