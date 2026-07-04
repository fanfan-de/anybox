# Layout 与 App Shell

## 桌面结构

优先使用稳定的桌面应用结构：

- 左侧 activity rail 或主 sidebar
- 可折叠/可 resize 的导航区
- 中央 workbench 或主内容区
- 可选右侧详情/辅助 sidebar
- 顶部 tab bar、toolbar 或窗口操作区
- 底部 composer、status bar 或 terminal 区域

不要把主应用做成滚动落地页。工作台类界面应尽量让关键区域填满视口，并使用内部滚动。

## 尺寸稳定

固定格式区域必须有明确尺寸约束：侧栏宽度、toolbar 高度、tab 高度、icon button 尺寸、列表行最小高度、表格列宽、pane min-size。hover、badge、loading、长文本不应改变整体布局。

列表行、表格行、设置行和任务行应保持单行扫描节奏。避免因为某一行加入副标题、说明、路径或备注而变成双行高度。需要更多信息时使用独立列、详情区、tooltip 或展开行。

## 面板布局

面板间用 1px divider、轻 surface 差异或 resize handle 区分。不要让每个区块都变成浮动 card。主内容区域可以用 panel 分组，但 panel 不应嵌套 panel。

## 响应式

桌面 Electron 仍需考虑窄窗口：

- 侧栏可折叠，右侧栏可隐藏。
- 表单和设置行在窄宽度下从两列变一列。
- toolbar 操作可收进更多菜单。
- 表格在窄宽度下优先保持关键列，次要信息进入详情面板或 row expansion。

## Electron 特性

窗口拖拽区和交互区必须明确区分。按钮、输入、tab、scroll area、webview、contenteditable 上应使用 `-webkit-app-region: no-drag`，避免拖拽区域吞掉点击。

## 页面容器

工具型页面使用 constrained content width 时，宽度应由任务决定。配置/文档类页面可限制宽度；表格、日志、工作台、diff、插件列表等管理界面应充分利用宽度。
