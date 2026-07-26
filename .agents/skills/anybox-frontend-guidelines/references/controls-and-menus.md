# 控件与菜单

## Semantic token 归属速查

组件按交互职责消费对应的完整 token 组合。复用 class 只复用结构，不允许改变以下归属：

| 组件职责 | 必须消费的 token 组 |
| --- | --- |
| Primary / secondary / danger button | `--semantic-button-<variant>-*` |
| Icon-only button | `--semantic-icon-button-*` |
| Input / textarea / select field / search field | `--semantic-field-*` |
| Settings switch | `--semantic-settings-switch-*` |
| Segmented control / view switch | `--semantic-segmented-control-*` |
| Dropdown / picker / listbox 的展开面板与选项 | `--semantic-dropdown-*` |
| 通用 list-detail row 及其 count/detail icon | `--semantic-list-detail-*` / `--semantic-detail-icon-*` |
| 已有独立 product/component 组的业务组件 | manifest 中与该组件同名的完整 `--semantic-<area>-*` 组合 |

组合控件必须拆分子部件判断。例如顶部 picker 的 trigger 使用对应按钮 token，搜索框使用 field token，展开面板、option 和辅助文字使用 dropdown token。不得因为它们共享一个 DOM 容器或 CSS class 就统一套用某一组 token。

## 按钮

按钮必须先按语义和所在 surface 选择种类，再写样式。不要因为当前页面“看起来需要一个按钮”就新增一次性 `*-button` 视觉规则。

通用规则：

- 操作使用真实 `<button>`。
- 每个 surface 最多只有一个 primary action；同一 action row 里不要并排放多个高强调按钮。
- 不要用颜色临时表达层级。primary、secondary、danger、toolbar、row action、menu trigger、segmented control 必须语义明确。
- 不要新增 icon+text button，除非该 surface 是命令工具条、复制/刷新/导入这类需要文字扫描的命令组，或同一 surface 已有稳定模式。
- toolbar、chrome、tab、pane header、row hover 操作优先使用 icon-only button，并提供 `aria-label`、`title` 或 tooltip。
- 明确命令可以使用 text-only button；如果命令依赖图标识别，使用 icon+text，但图标只作为辅助。
- icon button 同时锁定 `width`、`min-width`、`height`、`min-height`。
- text 和 icon+text button 锁定 `min-height`，使用固定 padding、gap、font-size、font-weight，避免不同文案造成高度跳动。
- hover/focus 使用背景、边框和文字/图标颜色变化，不使用 transform、尺寸变化或阴影抬升。
- disabled 状态保持布局尺寸，只降低 opacity 和 cursor；禁用按钮不能看起来像可点击 primary。
- loading 状态保持原尺寸，优先替换 leading icon 为 spinner 或在文字前放 spinner；不要让文案变长导致按钮宽度跳动。
- focus 使用组件自身的背景、边框、文字或指示器 token 表达，不使用 outline 或 inset ring。
- 按钮 CSS 只消费不带 `-light` / `-dark` 后缀的运行时 token。缺少合适 token 时，先在 schema v2 manifest 增加成对 light/dark semantic token，再运行生成器暴露运行时 token 给按钮使用。
- 按钮必须消费成组按钮语义 token，例如 `--semantic-button-primary-surface`、`--semantic-button-secondary-surface`、`--semantic-button-danger-surface` 及各自的 hover、border、text、disabled token。不要直接把 `--seg-accent`、`--brand-primary-active`、`--semantic-accent-icon-*`、`--semantic-error-*` 这类 accent/status/text/icon token 当作按钮完整状态；它们不覆盖按钮 default/hover/disabled 的完整状态矩阵，在 dark 主题下可能变成低对比或近白按钮。
- 禁止在按钮规则里硬编码 `#fff`、`#000`、固定灰色、固定粉色、固定紫色、固定品牌色或 `rgba(...)`。

按钮种类与样式：

| 种类 | 使用场景 | 视觉规则 | 常见文案 |
| --- | --- | --- | --- |
| Primary action | 当前表单、对话框、页面或 action row 的唯一主提交 | 填充色；使用 `--semantic-button-primary-*` token；边框同语义色或透明；文字高对比；hover 只增强填充或文字，不改变尺寸 | 保存、创建、安装、确认、打开工作区 |
| Secondary action | 普通命令、取消、测试、刷新、导入、复制、诊断、关闭 | 使用 `--semantic-button-secondary-*` token；中性面板底或透明底加中性边框；文字用 secondary/default token；hover 变为更高一层 surface | 取消、测试连接、导入 JSON、刷新二维码、复制 deep link、Diagnose |
| Danger action | 删除、移除、卸载、断开、清空、重置到不可恢复状态 | 使用 `--semantic-button-danger-*` token；默认不使用强填充，除非是确认删除对话框里的唯一主危险动作 | 删除、移除、卸载、清空、断开 |
| Ghost / tertiary action | 低频辅助动作、非关键入口、弱关闭动作 | 透明或无边框；文字/图标使用 muted token；hover 才显示轻 surface | 了解更多、跳过、展开、收起 |
| Icon-only toolbar button | toolbar、chrome、pane header、tab bar、行尾 hover action | 正方形固定尺寸；无文字；默认透明；hover/focus/active 用 icon button semantic token | 刷新、复制、关闭、返回、添加 |
| Icon+text command button | 一组需要快速扫描的命令，尤其是复制、刷新、导入、导出、打开文件夹 | secondary 视觉；固定高度；leading icon 16px；gap 固定；文案不换行，必要时 ellipsis | 复制 deep link、复制测试命令、导入 JSON |
| Text-only command button | 表单底部或对话框 action row 里的明确文本命令 | primary/secondary/danger 视觉之一；不临时加图标；文字居中 | Save profile、Save credentials、测试连接 |
| Row action button | 列表项、卡片行、slot card trailing action | 比页面按钮更紧凑；通常只在 row hover/focus-within 时出现；danger row action 仍用 danger token | 编辑、复制、删除、重命名 |
| Menu trigger button | 打开菜单、picker、更多操作、split button 的触发器 | 默认按所在 surface 选择 secondary 或 icon-only；打开时使用 active/current surface；必须有 expanded state | 更多、安装、自定义、新建 |
| Split button | 主动作加同族附加菜单 | 左侧主动作按 primary 或 secondary；右侧箭头只打开菜单；两段高度、边框、圆角必须统一 | 打开、安装、新建 |
| Segmented control | 同一上下文内互斥视图、页面分区或模式切换 | 不当作普通动作按钮；遵守下方 Segmented Control 规则 | Edit/Preview、Prompts/Skills |

语义选择规则：

- “保存设置 / 创建 / 安装 / 确认”这类提交动作只有在当前区域是主目标时才用 primary。
- “测试连接 / 诊断 / 导入 / 刷新 / 复制 / 取消 / 关闭”默认用 secondary，不要因为靠右或文案重要就改成 primary。
- “删除 / 移除 / 卸载 / 清空 / 断开”始终用 danger；不能只靠红色文字、位置或确认弹窗表达危险。
- “复制”类动作在 toolbar 或重复行里优先 icon-only；在命令组里允许 icon+text，并统一为 secondary command button。
- “登录 / Sign in”如果是当前 surface 的唯一推进动作可用 primary；如果旁边还有保存、诊断、取消等动作，按当前 action row 的主次重新判定。
- 不能把 disabled 的 primary 做成灰色实心按钮后继续维持主视觉；禁用态必须明显不可交互，同时保持文字可读。
- 同一 action row 的按钮应共用尺寸体系：页面/表单按钮用同一高度，toolbar 按钮用同一方形尺寸，row action 用同一紧凑尺寸。

推荐尺寸：

| 尺寸 | 使用场景 | 高度 | 圆角 | 字号/图标 |
| --- | --- | --- | --- | --- |
| Compact icon | toolbar、chrome、tab、row hover | 28-30px，宽高相等 | 6-8px | icon 15-16px |
| Compact command | 紧凑表单、设置页局部 action row、命令组 | 32px | 6px | 13px / icon 15-16px |
| Default command | 对话框、表单底部、页面主要 action row | 36-38px | 6px | 13-14px / icon 16px |
| Large command | 只在空状态或首屏引导主动作中使用 | 40px | 8px | 14px / icon 16px |

状态矩阵：

| 状态 | 要求 |
| --- | --- |
| default | 背景、边框、文字/图标全部来自按钮种类对应 semantic token |
| hover | 只改变背景、边框、文字/图标颜色；不改变尺寸、padding、gap、font-weight |
| focus-visible | 使用按钮自身 token 化状态表达；不要加 outline、inset ring、box-shadow ring |
| active / pressed | 用更强 surface 或 active text 表达；适用于 menu trigger、toggle、icon button |
| selected / current | 只有 toggle、segmented、tab、view switch 能使用；普通 command button 不使用 selected |
| loading | 保持按钮可测量尺寸；禁用重复点击；显示 spinner 或稳定文案 |
| disabled | opacity 降低、cursor default/not-allowed；保留布局尺寸；hover/focus 不切换到可交互视觉 |
| error / invalid | 用 danger token 表达；如果按钮动作失败，错误信息放在按钮附近的状态区，不把按钮长期染红，除非动作本身是 danger |

实现落点：

- 优先复用 `.primary-button`、`.secondary-button`、`.secondary-button.is-danger`、`.top-menu-view-button`、`.canvas-top-menu-button`、`.icon-button` 以及当前 surface 已有的语义按钮 class。
- 如果需要新增通用按钮能力，优先补 `primitives.css`，再让区域 class 组合消费；不要在某个页面 CSS 末尾追加覆盖式按钮主题。新增按钮变体时如果项目缺少对应的 `--semantic-button-<variant>-*` token，必须先在 manifest 补 token 并运行生成器，再写组件 CSS。
- 区域内可以有语义 class，例如 `.plugins-detail-install-button`、`.ssh-icon-button`，但它们必须映射到上面的按钮种类和 token，不得拥有独立的一套颜色、边框、圆角和状态。
- 完成按钮改动后检查 light/dark、hover、focus-visible、active/open、disabled、loading、窄宽度、长中文/英文文案和 icon 对齐。

## 输入与选择器

- input、textarea、contenteditable 保留原生编辑能力。
- 使用本地已有 focus 模式，优先通过背景、边框、文字或指示器 token 表达。
- 通用文本输入、textarea、select、搜索框和可编辑控件外壳使用成组字段语义 token：
  - 默认：`--semantic-field-surface` / `--semantic-field-border` / `--semantic-field-text`
  - 低强调字段：`--semantic-field-surface-muted`
  - 聚焦：`--semantic-field-surface-focus` / `--semantic-field-border-focus`
  - 禁用：`--semantic-field-surface-disabled` / `--semantic-field-border-disabled` / `--semantic-field-text-disabled`
  - 无效：`--semantic-field-border-invalid`
  - 占位符：`--semantic-field-placeholder`
- 不要再用 `--surface-panel`、`--surface-panel-muted`、`--seg-panel`、`--seg-panel-muted` 或按钮 semantic token 表达输入字段状态；组件确有独立语义时可以使用更具体的组件字段 token。
- 字段 focus 使用自身的 surface 与 border token，不使用 outline 或 box-shadow ring；disabled 和 invalid 状态不能只靠 opacity 表达。
- provider/model/theme 这类需要统一产品风格的选择器，优先使用 composer/settings 中已有 custom listbox/combobox 模式，不要直接使用原生 `<select>`。
- search field 保持紧凑，并与附近 row 对齐。

## Switch / Toggle

- Switch/toggle 用于一个独立布尔设置，例如启用/禁用、显示/隐藏、自动更新。不要用 switch 表达多个视图或多个模式之间的互斥选择；这种场景使用 segmented control、tabs 或 radio group。
- 使用真实 `<button>`，并设置 `role="switch"`、`aria-checked` 和可访问名称。内部轨道和圆点只作为视觉元素，使用 `aria-hidden="true"`。
- 设置页 row switch 默认沿用左侧 copy、右侧 control 结构；整行可点击时，row 本身是 switch button，右侧 pill 只负责状态展示。
- 轨道、边框、圆点、active、focus、disabled 必须使用运行时 semantic token。设置页 switch 默认消费：
  - focus row：`var(--semantic-settings-switch-row-surface-focus)`
  - track default：`var(--semantic-settings-switch-track-surface)` / `var(--semantic-settings-switch-track-border)`
  - track focus：`var(--semantic-settings-switch-track-border-focus)`
  - track active：`var(--semantic-settings-switch-track-surface-active)` / `var(--semantic-settings-switch-track-border-active)`
  - track disabled：`var(--semantic-settings-switch-track-surface-disabled)` / `var(--semantic-settings-switch-track-border-disabled)`
  - thumb：`var(--semantic-settings-switch-thumb-surface)`
  - thumb disabled：`var(--semantic-settings-switch-thumb-surface-disabled)`
- 不要把 `--semantic-button-*`、segmented token、`--seg-accent`、品牌色或状态色直接当作 switch 的完整状态矩阵；缺少区域语义时，先在 schema v2 manifest 补成对 light/dark 的 `--semantic-<area>-switch-*` token，再运行生成器暴露不带后缀的运行时 token。
- default、focus-visible、active/on、disabled 状态都要在 light/dark 下可读。focus 使用 row 背景或 track 边框表达，不使用 outline、inset ring 或 box-shadow ring。
- 尺寸必须稳定：track、thumb、thumb 位移、row 高度都显式定义，hover/focus/active/disabled 不改变尺寸、padding 或布局。

## Segmented Control

- 用于同一上下文内的互斥视图、页面分区或模式切换，例如 Prompts/Skills、Plugin/Connector/MCP/SSH/Mobile、Edit/Preview、transport 类型。不要用 segmented control 表达普通动作按钮组。
- 默认视觉采用顶部无外框 tab segment：外层只负责排布，不加边框、底色、投影或包裹胶囊；当前项用 segment 自身的选中底色表达。
- 优先复用 `top-menu-segment-list` / `top-menu-segment`。外层使用 `inline-flex`、`gap: 12px`、横向溢出隐藏滚动条，并设置 `-webkit-app-region: no-drag`；segment 使用稳定高度和 padding，默认透明背景，避免 hover/active 改变控件尺寸。
- 使用真实 `<button>`。页面内容分区切换使用 `role="tablist"` / `role="tab"` + `aria-selected` + `tabpanel`；局部二选一模式切换可使用 `role="group"` + `aria-pressed`；状态选择更接近表单值时使用 `radiogroup` / `radio` 语义。
- segmented 外层、item 状态和文字必须消费完整的 `--semantic-segmented-control-*` 组合：
  - 外层：`--semantic-segmented-control-surface` / `--semantic-segmented-control-border`
  - hover/focus：`--semantic-segmented-control-item-surface-hover` / `--semantic-segmented-control-item-text-hover`
  - active/selected：`--semantic-segmented-control-item-surface-active` / `--semantic-segmented-control-item-text-active`
  - 默认文字：`--semantic-segmented-control-item-text`
  - 辅助信息：`--semantic-segmented-control-item-meta-text` / `--semantic-segmented-control-item-meta-text-active`
  - disabled：`--semantic-segmented-control-item-text-disabled`
- 不要用 `--seg-text-*`、sidebar/tree row、button、dropdown 或基础 surface/text token 表达 segmented 状态。light/dark 差异必须来自 manifest 生成的 segmented runtime token；组件规则里不要写 `-light` / `-dark` token，也不要为 segmented 单独加主题分支。
- 如果通用 segmented 组合无法表达产品组件的状态，先在 schema v2 manifest 新增更具体的成对 component semantic token，再运行生成器；不要借用相邻组件的 token。
- active segment 不要依赖白底、重阴影、强对比投影或外层胶囊表达选中态；需要分隔时使用 token 边框或组件自身状态。
- focus 使用背景、边框、文字或指示器 token 表达，不使用 outline 或 inset ring。
- 完成后同时检查 light/dark：外层底色、active 片、hover/focus 片、文字颜色和 disabled 对比度都必须可读。

## 菜单

新增菜单前先复用现有模式：

- Sidebar/context menu：`.ui-context-menu`
- Composer menu：`.composer-menu-panel`、`.composer-command-menu`
- Git quick menu：`.git-quick-menu-*`
- Settings/provider picker：`.provider-model-picker-*`

菜单规则：

- 默认菜单行背景透明，只在 hover、focus、active、selected、highlighted 状态显示 surface。
- 下拉选择器和 listbox 菜单必须消费完整的 dropdown semantic token：
  - 面板：`--semantic-dropdown-menu-surface`
  - 选项悬停/聚焦：`--semantic-dropdown-option-surface-hover` / `--semantic-dropdown-option-text-hover`
  - 选项选中：`--semantic-dropdown-option-surface-selected` / `--semantic-dropdown-option-text-selected`
  - 默认选项文字：`--semantic-dropdown-option-text`
  - 计数和辅助信息：`--semantic-dropdown-option-meta-text` / `--semantic-dropdown-option-meta-text-selected`
- 可以复用 `.ui-context-menu`、`.composer-menu-panel` 或其他菜单的结构 class，但选择型 option 不得继承 `--context-menu-*`、field、button、segmented、sidebar tree、基础 surface/text 或业务区域 control token。若保留局部变量，它们必须一对一映射到上面的 `--semantic-dropdown-*` token。
- trigger 仍按 button/menu-trigger 语义处理；只有展开面板、option、option meta 和对应状态属于 dropdown token 组。带搜索的 picker 中，搜索输入继续使用 `--semantic-field-*`，不要用 dropdown option token 绘制输入框。
- 缺少状态时先在 schema v2 manifest 的 `component-dropdown-select` 组补充成对 light/dark token，再运行生成器。
- 动作菜单在语义合适时使用 `role="menu"` / `role="menuitem"`。
- 带搜索输入的 picker，如果普通 menu role 会损害可访问性，使用 dialog/searchbox/listbox 语义。
- 可能被 scroll/overflow 容器裁剪的菜单使用 portal 或 fixed 定位。
- 短菜单根据内容使用 fit-content 或 max-content，不要继承过宽的 selector 宽度。
- 紧凑 popover 默认隐藏滚动条，只有长内容确实需要位置反馈时再显示。

## Rows 与列表

- row 默认单行。
- label 加 trailing actions 使用 `grid-template-columns: minmax(0, 1fr) auto`。
- 如果本地区域已有模式，trailing row actions 只在 hover/focus 时出现。
- 名称、路径、模型、分支、session title 使用 ellipsis。
- 常见状态不要优先做成文字 badge，先考虑 icon、dot、spinner、progress 或颜色。

## 可访问性

- 键盘路径要完整：focus、activation、escape/close，需要时支持 arrow navigation。
- danger 不能只靠位置表达，必须使用语义 danger variant。
- 表示状态的 icon 必须通过 `aria-label`、title、tooltip 或邻近文本暴露含义。
