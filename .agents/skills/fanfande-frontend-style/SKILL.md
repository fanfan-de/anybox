---
name: fanfande-frontend-style
description: Fanfande Studio 全局前端产品风格规范。Use when Codex needs to design, build, restyle, review, or refactor React/Electron/Vite frontend UI, including desktop app shells, workbench panes, navigation, sidebars, settings, plugin management, dialogs, drawers, menus, forms, tables, lists, trees, cards, empty states, loading states, error states, and shared interaction components in a quiet desktop productivity style.
---

# Fanfande Frontend Style

## 核心方向

为 Fanfande Studio 构建安静、成熟、克制、偏桌面生产力工具的前端界面。优先考虑信息层级、稳定布局、紧凑但不拥挤的密度、可预测交互、长期使用不疲劳的视觉系统，以及符合 Electron 桌面应用的鼠标和键盘效率。

把 Obsidian-like 的“低装饰、面板化、克制强调色、原生偏好窗口感”抽象为全局产品气质，而不是局限于设置页。任何页面都应先服务工作流和内容密度，再考虑装饰表达。

## 工作流程

1. 在写 UI 前先检查目标应用已有 token、基础样式、相邻组件和交互模式。Fanfande Studio 当前优先使用 `src/renderer/src/styles/tokens.css`、`primitives.css`、`shell.css`、`sidebar.css`、`workbench.css`、`settings.css` 等本地样式。
2. 优先消费已有 CSS 变量，不要在已有等价 token 时硬编码颜色、圆角、阴影或动效。常见 token 家族包括 `--surface-*`、`--text-*`、`--border-*`、`--brand-*`、`--semantic-*`、`--seg-*`、`--mix-*`。
3. 判断当前任务属于哪些 UI 类别，只读取对应 reference。不要一次加载所有 reference。
4. 修改时保持局部一致：复用已有组件结构、class 命名、状态命名和测试约束。只有在现有模式明显无法承载新需求时再新增抽象。
5. 完成前检查亮色/暗色主题、hover、focus-visible、active、selected、disabled、loading、empty、error、窄视口、长中文/英文文本、键盘路径、窗口拖拽区域和 Electron `-webkit-app-region`。

## Reference 选择

- 总体原则和视觉气质：读取 `references/principles.md`。
- token、颜色、间距、圆角、阴影、动效：读取 `references/tokens.md`。
- app shell、标题栏、侧栏、主工作区、响应式：读取 `references/layout.md`。
- sidebar、tabs、breadcrumb、command palette、top menu：读取 `references/navigation.md`。
- panel、section、card、popover、modal、drawer、tooltip：读取 `references/surfaces.md`。
- 标题、正文、说明、代码、空状态文案：读取 `references/typography.md`。
- button、input、select、toggle、checkbox、radio、slider、segmented control：读取 `references/controls.md`。
- context menu、dropdown、select menu、command menu、action menu：读取 `references/menus.md`。
- list、table、tree、grid、detail pane、timeline、log viewer：读取 `references/data-display.md`。
- 表单布局、校验、保存状态、危险操作：读取 `references/forms.md`。
- toast、banner、loading、skeleton、progress、empty、error recovery：读取 `references/feedback.md`。
- hover、focus、keyboard、drag/drop、resize、shortcut、selection：读取 `references/interactions.md`。
- default、hover、focus、active、selected、disabled、readonly、error、warning、success 等状态：读取 `references/states.md`。
- 常见页面原型和组合方式：读取 `references/pages.md`。
- 明确不要做的视觉和交互反模式：读取 `references/avoid.md`。

## 真实预览

当需要判断文字规范是否符合预期视觉时，打开 `assets/style-preview/index.html`。这是一个自包含的静态样板间，覆盖 app shell、sidebar、workbench pane、settings rows、buttons、inputs、select、toggle、table、empty state、banner、toast、dropdown menu、dialog 和 theme toggle。

使用预览时不要把它当成必须逐像素复制的业务页面；它是风格基线和组件密度参考。预览界面默认避免在标题下放解释性文案，并压缩非必要 helper text，优先保持视觉精简。实际实现仍应先读取目标项目的相邻组件和本地 token。

## 文案极简规则

默认不要在标题、section、panel、card、表格行、设置行、菜单项下面常驻解释性文案。界面应先靠结构、标签、状态和控件本身表达含义，而不是用一行灰色小字解释这个区域在做什么。

只在信息会改变用户决策时保留辅助文案，例如错误原因、危险操作后果、权限影响、不可逆变更、空状态下一步、异步任务失败恢复。其余说明放到 tooltip、详情面板、文档入口或按需展开区域。

## 行内容单行规则

列表行、表格行、设置行、任务行、导航行和选择项默认只显示一行主要内容。不要在同一个行单元里堆“标题 + 灰色说明”的双行结构。

需要展示辅助信息时，优先放到独立列、右侧元信息槽、图标 tooltip、详情面板、展开行或 hover/focus 后出现的补充层。只有错误信息、日志正文、空状态说明、聊天/文档内容这类本身需要阅读的内容区域可以自然多行。

## 按钮规则

所有 button 默认不要边框，包括 primary、secondary、danger、ghost、icon button、toolbar button、dropdown trigger、menu item 和 chip-like action。用背景色、文字色、图标色、透明度和 focus ring 表达层级与状态。

button 不允许同时出现 icon 和文字。按钮只能是纯文字按钮或纯 icon button。常见工具、状态、快捷动作优先使用 icon button，并用 `aria-label`、`title` 或 tooltip 表达含义；需要明确命令文案时使用纯文字按钮。

icon button、toolbar button、sidebar rail button 和 top menu button 的 hover 必须使用统一语义：默认透明背景，hover/focus 只加轻背景和文字/图标色变化，active/selected 使用同一组 active surface 与 active text token。不要在 hover 上做 `translateY`、缩放、阴影抬升、边框显隐或尺寸变化；focus-visible 只额外显示 focus ring。

`is-expanded`、`aria-expanded` 和 `aria-pressed` 这类控件状态不默认等同 selected/active 视觉。折叠/展开按钮只有在产品明确需要表达“当前选中项”时才使用 active surface；普通展开状态的 hover 仍必须使用 hover token。

当按钮确实带有 active/selected 类时，`:hover` 和 `:focus-visible` 仍要保留可见 hover/focus surface，不能被后写的 `.is-active` 规则压回透明或只剩图标变色。

普通顶栏、工具栏、侧栏 rail 这类浅背景上的 icon button，hover/focus 的背景必须肉眼可辨；不要只改图标颜色，也不要使用弱到接近底色的透明度。默认以当前文字色约 20% 到 24% 的轻背景作为 hover surface，关闭/删除等危险窗口按钮可以使用 danger surface。左侧栏顶部菜单栏的 shell chrome 纯 icon button 是局部例外，按下一组规则执行。

Left sidebar 顶部菜单栏的纯 icon button 模式：作用域只限 `.left-sidebar-top-menu` 内的 `.sidebar-action`、`.top-menu-view-button` 和 `.sidebar-toggle-button.is-top-menu`。结构使用 `ShellTopMenu as="header"`，容器用 `left-sidebar-top-menu`，content 用 `left-sidebar-top-menu-content`，trailing 用 `left-sidebar-top-menu-trailing`。按钮必须是无文字的真实 `<button>`，用 SVG/icon 子元素表达动作，并提供 `aria-label`、`title` 或 tooltip。

Left sidebar 顶部菜单栏容器保持桌面 chrome 的低装饰：高度和最小高度使用 `--section-toolbar-height` / `--top-chrome-height`（当前约 40px），水平内边距约 12px，按钮间距约 4px，背景使用 `--seg-left-sidebar-top-menu-surface`，底部分隔线使用已有 mix border token。content 可以横向滚动并隐藏 scrollbar；动作组必须设置 `-webkit-app-region: no-drag`，避免吃掉窗口拖拽区里的按钮点击。

Left sidebar 顶部菜单栏按钮盒模型使用 `--top-chrome-icon-button-size`（当前约 28px）同时锁定 `width`、`min-width`、`height` 和 `min-height`，`padding: 0`，`align-self: center`，`border` 或 `border-color` 透明，`background: transparent`，`box-shadow: none`，`border-radius: 8px`。不要复用 sidebar rail、activity rail 或 pill button 的尺寸 token。

Left sidebar 顶部菜单栏按钮状态以 icon color 为主：default 使用 `--top-chrome-icon` 或 `--semantic-accent-icon`，hover/focus 仍保持透明背景、透明边框、无阴影、无 transform，只切换到 `--top-chrome-icon-hover` / `--semantic-accent-icon-hover`；active/pressed 仍保持透明背景，用 active icon token。`focus-visible` 必须保留 focus outline/ring。该模式不要在 hover 上加背景块、边框、缩放、阴影或位移。

同一组顶栏新增/关闭/切换 icon button 必须使用同一种图标来源和尺寸 token。不要在一个位置用文本 `+` glyph、另一个位置用 lucide `PlusIcon`；新增按钮统一使用 `PlusIcon`，并用 `--section-toolbar-icon-size` 控制 SVG 尺寸。

顶栏 icon button 的盒模型必须同时锁定 `width`、`min-width`、`height` 和 `min-height`。不要只写 `min-height`；后导入的全局按钮尺寸规则会把 hover 背景拉高，导致左右按钮 hover 高度不一致。普通顶栏工具按钮使用顶栏专用尺寸 token，不要复用 sidebar rail / activity rail 的全局 `--icon-button-size`。

activity rail / sidebar rail 的竖向 icon button 也要有 rail 专用尺寸 token，并用作用域选择器同时覆盖 view button 和 rail toggle。不要让它们回退到全局 `--icon-button-size`；active 按钮的 `:hover` 应有独立 hover surface，不能和静态 active 视觉完全相同。

固定尺寸 icon button 放在 full-width grid/flex 容器里时，容器必须显式居中，例如 grid 使用 `justify-items: center`，flex 使用 `align-items: center` 或 `justify-content: center`。缩小按钮尺寸后不要依赖默认对齐，否则 hover 背景会看起来偏左或偏右。

边框主要留给输入框、面板、表格、分隔线、浮层和必要的状态容器。只有当按钮没有边框会造成可发现性或可访问性问题时，才允许作为局部例外。

## 选择器规则

需要和产品风格统一的选择器不要直接使用原生 `<select>`。原生 select 展开后的 option 面板由浏览器或系统绘制，无法稳定套用 canvas dropdown 的背景、圆角、hover、selected 和无边框规则。

普通枚举、模式切换、主题选择、技能/MCP/模型选择等可见选择控件，应使用自定义 select/listbox 或 combobox。触发器、选项行和下拉面板必须沿用 canvas dropdown 的轻量样式。

## 状态表达规则

状态优先用 icon、dot、spinner、progress、颜色和位置表达，不要默认使用文字 badge，例如 `Active`、`Paused`、`Needs review` 这类状态文案不应作为主要视觉。

文字状态只在用户必须区分多个相近业务状态、审计记录、日志、详情页或可访问性文本中出现。图标状态必须提供 `aria-label`、`title`、tooltip 或附近详情，让含义可被读取和确认。

## 不可协商规则

- 不要把产品工具界面做成营销落地页、hero page 或装饰型 dashboard。
- 不要使用装饰性渐变、光斑、玻璃拟态、厚重阴影、大面积品牌色背景或一色系铺满的视觉。
- 不要嵌套卡片。panel 内可以有 row、section、list item，但不要再放一层装饰性 card。
- 不要在工具、面板、设置、表格、列表里使用 hero 级大标题。
- 不要在普通扫描行里使用“主标题 + 辅助说明”的双行内容。行内辅助信息要移到独立列、tooltip、详情面板或展开区。
- 不要给按钮默认加边框。按钮状态通过背景、文字、图标、透明度和 focus ring 表达。
- 不要在 button 中同时放 icon 和文字。使用纯文字按钮或纯 icon button。
- 不要把常见状态默认做成文字 badge。优先用图标、dot、spinner、progress 和语义色表达。
- 不要到处使用胶囊形文字按钮；能用图标表达的工具操作优先用 icon button，并提供 tooltip。
- 不要牺牲稳定尺寸。hover、active、loading 文本、图标、badge、快捷键槽位都不能导致布局跳动。
- 不要让说明文字常驻挤占紧凑控件空间。默认不写标题副文案、panel 描述、row 描述和菜单项说明；复杂说明放到 tooltip、详情区、help text、文档入口或按需展开区。
- 不要破坏输入框、textarea、contenteditable、webview 的原生右键菜单，除非产品明确接管该区域。
- 不要为了统一视觉而忽略可访问性：focus-visible、键盘操作、aria 状态、禁用语义必须完整。

## 输出习惯

当生成或修改前端代码时，先说明将读取哪些本地样式和 reference；实现后用目标项目已有验证方式检查。涉及明显视觉改动时，应尽量用浏览器或截图做一次实际渲染核对。
