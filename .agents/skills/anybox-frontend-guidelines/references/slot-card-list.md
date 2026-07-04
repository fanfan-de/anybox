# 槽位式卡片列表

## 范围

用于一组数量有限、名称稳定、可逐项进入或编辑的槽位/条目。每个条目代表一个固定位置或固定对象，而不是无限增长的内容流。

不要在本规范里绑定具体业务域。命名、文案和图标由调用场景决定，本规范只约束这种交互组件本身。

## 交互模型

- 整体是 list，不是 dashboard，也不是营销式 card grid。
- 每个槽位是一个可聚焦、可扫描的 list item，可使用轻量 card surface 承载。
- 主交互是进入、打开、编辑或选择某个槽位；不要让整张卡片和尾部按钮同时触发含义不同的主动作。
- 如果整项可点击，尾部 action 应与整项主动作一致，或只作为更明确的同义入口。
- 如果尾部 action 触发不同动作，整项本身不要再绑定 click，避免产生双主动作。
- 选中态、当前态、禁用态和异常态必须有稳定视觉表达，并且不能只依赖颜色。

## 信息结构

- 每个条目优先使用两层信息：主标题 + 当前值/摘要。
- 主标题单行显示；当前值或摘要默认一到两行，超出使用 ellipsis 或明确换行策略。
- 辅助说明只在影响判断时出现；不要在每个条目里长期展示解释性文案。
- 状态信息优先使用 icon、dot、颜色或短标签；状态容易混淆时再加文字。
- 条目内使用 `grid-template-columns: minmax(0, 1fr) auto`，左侧内容必须允许收缩，右侧 action 尺寸稳定。

## 视觉规则

- 使用克制的 panel/card surface，radius 通常 4px 到 8px。
- 优先使用 token 化的 surface、border、text 和 semantic color，不要硬编码灰色、白色、紫色或透明白。
- 默认态不要做强阴影、渐变、玻璃拟态或大面积强调色。
- hover、focus、active 只改变背景、边框或文字颜色，不改变尺寸、位置或阴影高度。
- 条目之间保持稳定间距；不要卡片套卡片。
- 当前项或激活项的强调应弱于 dialog/overlay，避免抢占页面层级。

## 主题与语义 Token

- 槽位式卡片列表必须同时支持 light 和 dark 主题；组件实现不能只针对当前截图或当前主题调色。
- 组件 CSS 只能消费不带 `-light` / `-dark` 后缀的运行时 token，例如 `--semantic-<scope>-slot-card-list-item-surface`，不要在组件规则里直接引用 light/dark token。
- light/dark 差异必须放在 `tokens.css`：先定义成对的 `--semantic-<scope>-slot-card-list-<part>-<state>-light` 与 `--semantic-<scope>-slot-card-list-<part>-<state>-dark`，再在 `:root` 和 `:root[data-theme="dark"]` 中映射到不带后缀的运行时 token。
- `<scope>` 使用当前区域或组件的语义前缀；只有这个模式被做成跨区域通用组件时，才使用 `slot-card-list` 作为全局 scope。
- 新增 token 前先查找已有 `--surface-*`、`--text-*`、`--border-*`、`--semantic-*`、`--mix-*` 是否已经能表达同一语义；已有合适 token 时直接复用，不要重复定义近似颜色。
- 如果缺少合适 token，至少覆盖这些状态：`default`、`hover`、`focus`、`active`、`disabled`、`selected/current`、`error/invalid`。
- 每个状态需要分别考虑 item surface、item border、primary text、secondary text、state indicator、trailing action surface/text/border；不需要的部分可以复用相邻语义 token，但不能退回硬编码颜色。
- 不要使用 `var(--token, #fff)`、`var(--token, rgba(...))` 这类硬编码 fallback；fallback 如确实需要，也必须是另一个 token。
- focus 状态使用 item/action 的背景、边框、文字或指示器 token 表达；不使用 outline 或 inset ring。
- 完成后必须检查 light 和 dark 两种主题下的 default、hover、focus、active、disabled、selected/current、error/invalid 状态，确认文字、边框、图标和操作按钮都可读，并且没有白底、黑底、紫色或透明白等硬编码残留。

## 操作控件

- 操作必须使用真实 `<button>`，并保留 `:focus-visible`。
- 明确命令可以使用 text-only button；工具型或重复型操作优先使用 icon-only button，并提供 `aria-label`、`title` 或 tooltip。
- 常驻 action 不应造成内容被挤压；空间不足时优先保持标题和值可读，再将次要操作收进 menu。
- disabled 状态保持按钮尺寸，只降低可用性表达，不造成布局跳动。

## 键盘与响应式

- Tab 可以进入列表项或尾部操作；Enter/Space 激活当前焦点的主动作。
- 需要列表内方向键导航时，使用一致的 roving focus 或本地已有 listbox/tree 模式。
- 窄窗口下条目保持单列堆叠，右侧操作可以换到下一行，但不能覆盖文本。
- 长中文、英文长词、路径类内容必须有明确截断或换行策略，不能与操作控件重叠。

## 适用判断

适合使用此组件：

- 条目数量较少且结构固定。
- 用户主要是在多个固定槽位之间进入、查看或修改。
- 每个条目需要同时展示名称、当前内容摘要和一个明确操作。

不适合使用此组件：

- 条目数量很多，需要搜索、排序、批量选择或虚拟滚动。
- 每项包含大量字段，更接近表格或 detail panel。
- 主任务是持续浏览内容流，而不是进入固定条目。
