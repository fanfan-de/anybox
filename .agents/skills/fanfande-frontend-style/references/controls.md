# Controls

## 通用规则

控件要紧凑、稳定、可键盘操作。优先复用现有 `.primary-button`、`.secondary-button`、icon button、input、select、toggle 等基础样式。新增控件前先查相邻实现。

控件组默认只显示 label 和控件本体，不要为普通控件常驻一行解释性 helper。说明放到 tooltip、错误文本、详情区或按需展开区域。

## Button

所有 button 默认不要边框。包含 primary、secondary、danger、ghost、icon button、toolbar button、dropdown trigger、menu item 和 chip-like action。使用背景色、文字色、图标色、透明度和 focus ring 区分层级。

button 不允许同时出现 icon 和文字。按钮只能是纯文字按钮或纯 icon button。icon button 必须提供 `aria-label`、`title` 或 tooltip；纯文字按钮不额外加图标。

- primary：用于创建、确认、保存、发送等主要动作。
- secondary：用于普通动作、取消、打开、选择。
- ghost/icon：用于工具栏和行内轻量操作。
- danger：用于删除、重置、断开、清空等破坏性动作。

按钮高度通常 30px 到 38px。不要把所有操作都做成大号 CTA。

不要为了“看起来像按钮”添加 1px 边框。边框留给输入框、面板、表格、浮层或状态容器；按钮只在无边框会明显降低可发现性时作为例外。

## Input 与 Textarea

输入框应有稳定高度、清晰 focus-visible、placeholder 低对比。错误信息放在输入附近，不要只靠红色边框。textarea 要处理 resize、滚动和长文本。

## Select 与 Combobox

需要统一视觉的选择器不要直接使用原生 `<select>`。原生 option 面板由浏览器或系统绘制，无法稳定控制展开层的背景、圆角、hover、selected 和无边框规则。

简单枚举使用自定义 select/listbox，触发器使用无边框按钮，展开层使用 canvas dropdown 的轻量面板和选项行。需要搜索、分组、异步结果或复杂 label 时用 combobox/menu。短选项菜单宽度贴合内容，长选项要省略并提供 tooltip 或详情。

只有在明确接受系统原生外观、控件不属于核心产品 UI、或可访问性/平台一致性优先于视觉统一时，才使用原生 `<select>`。

## Toggle、Checkbox、Radio

二元开关用 toggle，批量选择或独立布尔项用 checkbox，互斥选项用 radio 或 segmented control。不要用 toggle 表示一次性动作。

## Slider 与 Stepper

数值调节需要显示当前值、单位、范围和边界。精确值优先加 input 或 stepper，不要只给 slider。

## Segmented Control

用于同级模式切换，选项数量通常 2 到 5 个。不要用于导航深层页面。选中态清晰但克制。

## Badge 与 Chip

badge 表示状态或数量，chip 表示标签或筛选条件。不要让 chip 变成常规按钮替代品。可删除 chip 需要固定关闭按钮槽位。

## Toolbar Controls

工具栏优先 icon button。常见操作用熟悉图标：保存、下载、刷新、搜索、关闭、更多、展开、收起、设置。没有熟悉图标时用短文本按钮。
