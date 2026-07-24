# Cinema 本地 ComfyUI 工作流（Beta）

Anybox Cinema 现在直接发现并运行用户保存在 ComfyUI 中的 APP mode 工作流。ComfyUI
继续负责节点、模型和工作流编辑；Anybox 根据工作流公开的输入与输出自动生成界面，不再提供
内置模型清单、固定工作流或手写参数映射。

## 使用前准备

- 启动本机 ComfyUI。默认地址为 `http://127.0.0.1:8188`。
- Anybox 仅允许连接 loopback 地址，例如 `127.0.0.1`、`localhost` 或 `::1`。
- 不需要安装 Bridge 或工作流转换插件。若 ComfyUI 提供可选的
  `/workflow/convert`，Anybox 会优先使用；不可用时自动使用内置转换器。
- 工作流中用到的自定义节点和模型必须已经安装在当前 ComfyUI 环境中。

## 在 ComfyUI 中准备工作流

1. 在 ComfyUI 中打开或创建一个能正常运行的工作流。
2. 打开 App Builder / APP mode。
3. 明确选择要交给 Anybox 用户填写的输入。
4. 明确选择要由 Anybox 收集的输出。
5. 将工作流保存到 ComfyUI 用户工作流目录。
6. 回到 Anybox，打开 Cinema 或在设置页点击“刷新工作流”。

Anybox 只把 ComfyUI 官方前端写入 `extra.linearData.inputs` 和
`extra.linearData.outputs` 的内容当作界面契约。节点名称、标题或备注不会被用于猜测要公开的
参数。普通 UI 工作流即使能被发现，如果没有 APP mode 输入/输出契约，也会显示为不可运行。

## 自动发现范围

Anybox 通过 ComfyUI 用户数据接口递归枚举 `workflows` 目录中的 `.json` 文件。

- 会发现：已经保存的用户工作流及其嵌套目录。
- 不会发现：模板、历史记录、队列记录和仍未保存的画布。
- 首次打开 Cinema、修改端点或 ComfyUI 用户时会自动扫描一次。
- 此后不做后台轮询；在 ComfyUI 保存修改后，请点击“刷新工作流”。

刷新失败时，Anybox 保留最后一次成功目录并标记为 stale；stale 目录仅供查看，不能提交。
单个损坏或不兼容的文件不会阻止其他工作流被发现。

每次扫描最多列出并处理 500 个工作流，单文件上限为 8 MiB，总读取上限为 64 MiB，并发读取数为
4。超过 500 个时目录显示整体诊断；前 500 个中触发文件或总量限制的项目会保留并显示具体原因。

## 单用户与多用户

若 ComfyUI 没有 `/users` 接口，Anybox 使用 `default` 用户。只有一个用户时会自动选择。
发现多个用户时，请在：

`设置 → Video Providers → Local ComfyUI → ComfyUI 用户`

选择用户并保存。后续工作流发现和执行请求都会携带对应的 `Comfy-User`。

## 自动生成的控件

Anybox 按 APP mode 中的顺序生成控件，控件类型和选项来自工作流及实时
`/object_info`：

- 单行和多行文本、提示词；
- `INT`、`FLOAT`、seed、步长和范围；
- `BOOLEAN`；
- combo 和模型下拉框；
- 图片、视频和音频文件输入；
- 明确定义为可序列化对象的 JSON 输入。

媒体文件会先导入当前 Anybox 项目，检查 MIME 和大小，然后上传到 ComfyUI。浏览器只提交
APP mode control key 与对应值；Agent 不允许修改工作流未公开的节点输入。

自定义前端 widget、无法解析的 APP 绑定或未知输入类型会让工作流保持可见但不可运行，并在
工作流旁显示原因。

## 输出支持

首版支持：

- 一个或多个图片输出节点；
- 一个或多个视频输出节点。

同一工作流的输出必须属于同一媒体类型。图片与视频混合输出、音频输出、3D 输出及未知文件
输出目前会显示为“不可运行”。运行完成后，Anybox 会收集 APP mode 选中的全部同类输出，
通过 ComfyUI `/view` 下载并验证真实 MIME。

## 模型与节点依赖

模型不再是 Local ComfyUI provider 的独立能力目录，也不需要在 Anybox 手动配置。

- 工作流主动公开的模型控件会使用当前 ComfyUI 的实时选项。
- 固定在工作流内部的模型只做依赖校验，不额外显示为 Anybox 设置项。
- Anybox 优先读取 Workflow 1.0 的 `models` 声明，同时检查 API prompt 中模型类 combo
  保存值是否仍存在。
- 缺少自定义节点、模型或保存的 combo 值时，工作流仍可见，但提交按钮会被禁用并显示缺失项。

安装或删除节点/模型后，请重启或刷新 ComfyUI，再在 Anybox 刷新工作流。

## 修改工作流后的行为

工作流 ID 由 ComfyUI 端点、用户和保存路径确定，因此修改文件内容不会改变 ID。内容、节点
定义、转换结果或转换器版本变化时，revision 会变化。

刷新后 Anybox 会：

- 对同一路径自动采用新 revision；
- 按稳定 control key 保留类型兼容的表单值；
- 删除失效值，并为新增控件填入工作流默认值；
- 在输出类型改变或工作流变得不可运行时停止生成并要求重新选择。

提交时 Agent 会再次核对 `workflowID + revision`。如果工作流已变化，请求会返回
`COMFYUI_WORKFLOW_REVISION_CHANGED`，不会静默执行其他版本。每个任务还会保存不可变的 UI
工作流、API prompt 和 digest 快照，所以任务提交后再修改源工作流不会改变该任务。

## 常见问题

| 现象或错误 | 处理方式 |
| --- | --- |
| 未发现工作流 | 确认工作流已保存到 ComfyUI 用户 `workflows` 目录，然后刷新。 |
| `COMFYUI_APP_MODE_MISSING` | 在 ComfyUI App Builder 中选择输入和输出后重新保存。 |
| `COMFYUI_USER_SELECTION_REQUIRED` | 在 Local ComfyUI 设置中选择正确用户并保存。 |
| 缺少节点 | 安装对应自定义节点，重启 ComfyUI 后刷新工作流。 |
| 缺少模型或 combo 值 | 安装模型，或在 ComfyUI 中选择当前存在的值并保存。 |
| 工作流目录为 stale | 恢复 ComfyUI 连接并成功刷新后才能再次提交。 |
| `COMFYUI_WORKFLOW_REVISION_CHANGED` | 刷新工作流，检查更新后的表单，再重新提交。 |
| 工作流已发现但不可运行 | 展开/查看该工作流的 issue；未知 widget、混合输出等首版暂不支持。 |

扫描和连接测试只读取服务、用户数据、节点定义及工作流文件，绝不会调用 `/prompt` 或创建
ComfyUI 队列任务。

## 旧版迁移

Local ComfyUI 的内置 LTX 模型、固定 profile、API workflow 和专用参数绑定已经移除。
历史已完成任务及其输出仍可查看；没有 workflow target 的旧草稿会提示重新选择已发现的
工作流。升级时仍处于排队或运行状态的旧任务会确定性标记为
`COMFYUI_LEGACY_WORKFLOW_REMOVED`，任务记录会保留。

## 参考

- [ComfyUI APP mode 文档](https://docs.comfy.org/interface/app-mode)
- [ComfyUI 官方 APP mode 实现](https://github.com/Comfy-Org/ComfyUI_frontend/blob/main/src/stores/appModeStore.ts)
- [ComfyUI 官方 userdata 路由](https://github.com/Comfy-Org/ComfyUI/blob/master/app/user_manager.py)
