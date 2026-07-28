# 布局与 Surface

## App Shell

桌面 shell 是固定工作台布局，不是网页落地页。

重要结构：

- `.window-shell`：全视口窗口 surface。
- `.app-shell`：包含 activity rail、左侧栏、中间 canvas、右侧栏的主 grid。
- `.activity-rail`：紧凑的垂直模式 rail。
- `.sidebar`：左侧导航和右侧检查区域。
- `.canvas.is-workbench`：中间工作台 surface。

尊重既有 shell 尺寸变量：

- `--activity-rail-width`
- `--sidebar-width`
- `--right-sidebar-width`
- `--section-toolbar-height`
- `--section-toolbar-control-size`
- `--section-toolbar-icon-size`

## Workbench Pane

Workbench pane 应该像 shell 的一部分，而不是浮动页面。

- 保持内容在既有 `WorkbenchPaneSurface` 结构里。
- 使用 `--pane-content-max-width` 和 pane gutter，不要硬编码阅读宽度。
- 父级 pane 固定时，主内容区应独立滚动。
- 需要收缩的主内容轨道使用 `minmax(0, 1fr)`。

## 顶层 Chrome 与拖拽区域

- drag region 里的所有可点击控件都必须设置 `-webkit-app-region: no-drag`。
- 不要把交互控件放在可能被系统窗口控制按钮覆盖的位置。
- top menu icon button 必须使用稳定方形尺寸和一致的 SVG 尺寸。

## Surface

- 页面 section 使用全宽 shell band 或无框布局。
- 卡片只用于重复记录、dialog 和聚焦工具。
- 不要卡片套卡片。
- panel radius 保持克制，通常 4px 到 8px，除非本地 token 明确要求更大。
- 优先使用 border 和 divider；阴影只用于 overlay 等确实需要抬升的层。

## 响应式

桌面端是主要目标，但窄窗口必须可用。

- 新增局部媒体查询前先检查 `responsive.css`。
- 约 900px 以下，很多 action row 和 session banner 会纵向排列。
- 约 760px 以下，settings 和 plugin layout 会折叠为单列。
- 检查 sidebar、composer、menu 和 permission prompt 不发生横向溢出。
