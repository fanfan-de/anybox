---
name: frontend-ui-style-kit
description: 可复用的前端基础 UI 样式模板与实现规则。当前重点覆盖右键菜单、上下文菜单、下拉菜单、命令菜单、浮层面板、滚动条、按钮、输入框等基础界面组件；适用于 Codex 在 React、Electron、Vite 或基于 CSS token 的前端项目中设计、实现或重构共享 UI 样式。
---

# 前端 UI 样式模板

## 用途

使用这个 skill 为小型产品级 UI 基础组件套用一致、可复用的样式基础。优先读取目标应用已有的设计 token、组件模式和相邻样式，再用本 skill 的模板补齐缺失部分。

## 工作流程

1. 在写样式之前，先检查目标应用已有的 token、基础样式和相邻组件。
2. 将本 skill 的语义 token 映射到本地 token，避免在已有等价 token 时硬编码颜色。
3. 只在需要时加载对应参考文档：
   - 右键菜单、自定义上下文菜单：读取 `references/context-menu.md`。
   - 页面滚动条、长滚动容器：读取 `references/scrollbar.md`。
4. 基础组件样式要保持紧凑、可操作、可复用。除非组件明确属于某个业务功能，否则避免使用过于业务化的命名。
5. 完成前检查亮色主题、暗色主题、键盘操作、鼠标操作、视口边缘定位、禁用状态和长文本。

## 基础规则

- 优先使用现有 CSS 变量。常见映射包括 surface、elevated surface、border、primary text、secondary text、focus outline、shadow、radius 和 motion duration。
- 菜单样式优先服从应用已有的 semantic token。常见映射包括 dropdown/menu surface、tree/list row hover surface、hover text、danger text/surface、border、font family、shadow 和 radius。
- 菜单和控件圆角保持克制。普通应用基础组件使用 4px 到 8px，除非当前设计系统明确使用其他圆角；浮层菜单窗口的外层圆角可比菜单项或小控件略大 1px 到 2px，优先使用本地 menu/dropdown radius token。
- 菜单宽度要贴合内容。不要让短标签菜单套用过宽的通用 selector 宽度；图标 + 短文本的应用选择菜单优先让面板用 `width: max-content` / `fit-content` 按最长项推断宽度。此类菜单不要继承 184px、220px 这类通用 `min-width`；用 `min-width: 0` 或很小的内容下限，只保留视口保护用的 `max-width`。菜单项本身仍应 `width: 100%` 填满已推断出的面板宽度，确保每一行 hover/selected 背景等宽。
- 菜单项默认不要有背景块。只有 hover、focus、active、selected 或 highlighted 状态才显示背景；按钮触发的下拉菜单也遵守这一点。
- 交互行使用稳定尺寸：固定最小高度、明确图标槽位、文本省略、可选快捷键槽位。
- 短右键菜单、短下拉菜单和按钮触发的动作菜单默认不显示、不预留右侧滚动条槽位；只有菜单项确实可能超过视口时才允许内部滚动。紧凑弹层即使需要滚动，也优先隐藏可见 scrollbar，避免右侧出现拖动条或空白槽位；谨慎使用 `scrollbar-gutter: stable`。
- 页面级、主内容区和长列表的可见滚动条采用轻量标准样式：轨道透明或贴合页面背景，不画外框；滑块窄、圆角胶囊、低对比中性灰，默认不抢视觉，hover 或拖动时才略微加深；不要使用彩色、渐变、阴影、加宽滚动条或常驻背景槽。具体实现读取 `references/scrollbar.md`。
- 紧凑菜单不常驻显示解释性小字。将说明放在 hover tooltip、`title`、`aria-describedby` 或详情面板里；菜单行内只保留主标签、状态/动作词和必要图标。
- 破坏性操作使用语义变体。不要依赖菜单项位置来编码危险样式。
- 动作菜单优先使用 `role="menu"` 和 `role="menuitem"`。根据应用交互模型一致地使用 `aria-disabled` 或 `disabled`。
- 带搜索框的菜单使用同一套菜单 surface、radius、hover、focus token；搜索框固定在顶部，下面的结果区才滚动，但不要显示右侧拖动条或预留 scrollbar 区域。语义上可使用 `role="dialog"` 包含 `searchbox` + `listbox`，不要为了套用普通菜单角色而牺牲搜索输入的可访问性。
- 可能被滚动容器或 `overflow` 裁剪的浮层菜单，使用 portal 或 fixed 定位渲染。
- 除非产品明确接管该区域，否则保留输入框、textarea、可编辑内容和 webview 中的浏览器原生右键菜单。
- 不要给工具型 UI 添加装饰性卡片、夸张阴影、渐变或营销页式视觉处理。

## 扩展方式

每个基础组件新增一个聚焦的参考文档，例如 `references/button.md` 或 `references/dialog.md`。`SKILL.md` 只保留导航和共享规则。
