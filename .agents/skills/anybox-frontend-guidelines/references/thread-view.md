# ThreadView

主要项目文档：`C:/Projects/Anybox/docs/thread-view-frontend-design.md`。

## 实现文件

- `packages/desktop/src/renderer/src/app/thread/ThreadView.tsx`
- `packages/desktop/src/renderer/src/styles/thread.css`
- `packages/desktop/src/renderer/src/app/workbench/WorkbenchPaneSurface.tsx`
- `packages/desktop/src/renderer/src/styles/workbench.css`
- `packages/desktop/src/renderer/src/styles/composer.css`
- `packages/desktop/src/renderer/src/styles/responsive.css`

相关测试：

- `packages/desktop/src/renderer/src/app/thread/ThreadView.test.tsx`
- `packages/desktop/src/renderer/src/App.test.tsx`

## 设计意图

ThreadView 是 agent 执行记录视图，不是普通聊天窗口。

它同时支持三类阅读：

- 用户快速读取最终 assistant 回复。
- 开发者扫描 reasoning、tools、workflow、file changes 和 debug traces。
- 用户从消息树选择 Branch，或从某条回复 fork 新任务。

优先级：

- 主回复优先，trace 信息弱化或折叠。
- 桌面端高密度，适合长时间扫描。
- 消息动作贴近对应消息。
- 多 pane workbench 中保持固定可读宽度。

## 嵌入模型

可见 pane 结构：

```text
PaneTabBar
SessionCanvasTopMenu
ThreadView
ComposerTaskProgress
Composer
ComposerUtilityBar
```

主 pane 的 `Composer` 是 `ThreadView` 的 sibling，不是子组件。

## Trace Section

Assistant trace item 按 section 分组，而不是只按 `item.kind`：

- `response`：最终回复，或 response 语境中的问题。
- `reasoning`：模型推理或摘要式思考。
- `tools`：工具调用 input/output/status。
- `sources`：来源引用。
- `approvals`：permission/question 决策。
- `file-change`：patch、file、image 产物。
- `workflow`：step、retry、snapshot、task-state、subtask、compaction。
- `debug`：developer metadata，默认隐藏。

## 视觉层级

- response section 透明且轻量，阅读感接近正文，不是卡片。
- user turn 右对齐并限制宽度，使用 `--surface-user-bubble`。
- completed reasoning/tools 对比度更低，通常折叠。
- file changes 不应淹没最终回复；有 image 时展示图片和最近变更，否则展示最新 patch。
- debug 内容不能干扰普通用户。

## 交互规则

- 除非任务明确修改滚动逻辑，否则保留 bottom-lock 行为。
- 只有用户已接近底部时，新 turn 才继续锁底。
- Assistant actions 可以在 hover、focus 或 copied 状态显示，但必须保证键盘可发现。
- Permission prompt 是阻塞决策点，使用 warning 语义。
- Ask-user card 需要 answered 状态，避免重复提交。
- Lightbox 打开时要避免背景滚动干扰。

## 维护规则

修改 ThreadView 时检查是否影响：

- `Turn` 或 `AssistantTraceItem` 的分组、显示、折叠规则。
- response、trace、file-change、permission、question、branch actions 的视觉层级。
- 多 pane、窄窗口和 right sidebar 场景。
- `ThreadView.test.tsx` 或 `App.test.tsx`。
- `docs/thread-view-frontend-design.md`。
