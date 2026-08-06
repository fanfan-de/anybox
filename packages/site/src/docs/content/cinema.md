# anybox for cinema

anybox for cinema 用本地文件夹管理 AI 影视项目，以 `Text`、`Image`、`Video` 和 `Audio` 四类节点组织分镜、素材与生成流程。

> 项目文件夹是唯一事实来源。插件不保存供应商密钥，也不是视频生成服务；生成由 Cinema Runtime 调用你在 Anybox 中配置的模型服务。

## 开始使用

1. 在“插件”中安装 Cinema 并为当前项目启用。
2. 打开专用本地工作区。
3. 要求 Agent 初始化项目，并说明片名、类型、时长和已有素材。

初始化可重复执行：只补齐缺失结构，不覆盖用户文件。无效 JSON 会被报告而不是自动清空。

示例：

> 初始化一支 45 秒城市夜景短片，创建三镜头分镜，只用 Text 和 Image 节点，不启动生成；最后列出新建文件和待确认项。

## 项目结构

| 路径 | 用途 |
| --- | --- |
| `.anybox-cinema/project.json` | 项目元数据 |
| `.anybox-cinema/providers.json` | 供应商绑定，不含密钥 |
| `.anybox-cinema/canvas.json` | 节点、连接和画布状态 |
| `.anybox-cinema/tasks/`、`events.jsonl` | 任务与事件记录 |
| `prompts/`、`references/` | 脚本、提示词与参考资料 |
| `assets/`、`generated/` | 原始与生成中素材 |
| `renders/`、`exports/` | 渲染结果与交付文件 |

移动素材后应更新画布引用。不要在 `.anybox-cinema` 中保存密钥或密码。

## 节点与工具

| 节点 | 内容 |
| --- | --- |
| `Text` | 故事、镜头、对白、提示词和备注 |
| `Image` | 概念图、分镜帧和视觉参考 |
| `Video` | 镜头片段和渲染结果 |
| `Audio` | 配音、音乐、环境声和音效 |

本地 MCP 提供：

| 工具 | 作用 |
| --- | --- |
| `cinema_get_project_summary` | 只读项目概要与节点 |
| `cinema_apply_command` | 经确认修改画布 |
| `cinema_create_storyboard` | 经确认创建或更新分镜 |

读取概要不会授权后续写入。请求中应分别说明是否允许写入、是否立即生成，以及产生费用或外部发送前是否停止。

## 数据与排障

项目资料默认留在工作区；启动生成时，相关输入会发送给所选供应商。凭据只应保存在 Anybox 的凭据系统中。

- **没有 Cinema 结构**：确认插件已启用，再重新初始化。
- **JSON 无效**：先备份并修复，或明确授权从可恢复信息重建。
- **未知节点**：先报告引用，再转换为四种支持类型。
- **有分镜但无视频**：确认 Cinema Runtime、供应商账号、额度和模型能力，再明确启动生成。
