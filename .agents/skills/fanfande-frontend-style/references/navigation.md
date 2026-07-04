# Navigation

## 导航类型

按任务选择导航形态：

- app shell 主导航：activity rail、sidebar、workspace tree
- 同级视图切换：tabs、segmented control、top menu
- 层级定位：breadcrumb、tree、path row
- 快速跳转：command palette、search menu
- 上下文操作：action menu、context menu

## Sidebar

sidebar 应紧凑、可扫描、可折叠。导航行如果使用 button，应使用纯文字或纯 icon，不要 icon + label 混排。selected 状态优先使用轻背景、左侧细线或强调文字，不要大面积品牌色填充。

## Tabs

tabs 应像桌面工作台标签：高度稳定、关闭按钮不挤压标题、active/inactive/hover 清晰。tab 标题长时省略，关闭按钮和 dirty state 使用固定槽位。

## Breadcrumb

breadcrumb 用于表达路径，不用于替代主导航。每一段都应可点击或明确不可点击；长路径中间截断，末尾当前项完整优先。

## Command Palette

命令面板是搜索和行动入口，不是说明文档。结果行包含图标槽、主标题、可选上下文、快捷键槽。不要在每行塞长说明；长说明进入详情区或 tooltip。

## Top Menu

顶部工具按钮优先 icon button。常见操作使用 lucide 或现有 icon 系统；陌生图标需要 tooltip。需要文字命令时使用纯文字按钮，不要 icon + text 混排。

## 状态

导航项需要覆盖 default、hover、focus-visible、selected、active、disabled、loading。selected 表示当前视图，active 表示正在按下或当前临时操作，不要混用。
