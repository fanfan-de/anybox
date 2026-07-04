# 设置与管理页面

## 范围

用于 settings、providers、models、plugins、connectors、MCP servers、global skills、prompt presets，以及类似的管理型界面。

优先检查文件：

- `packages/desktop/src/renderer/src/styles/settings.css`
- `packages/desktop/src/renderer/src/styles/workbench.css`
- `packages/desktop/src/renderer/src/app/tools/BuiltinToolsPage.tsx`
- `packages/desktop/src/renderer/src/app` 下相关组件

## 布局

- 设置页是高密度操作界面，不是营销页。
- 优先使用 nav + detail、list + detail 或 document-width editor 布局。
- 使用紧凑 service row 和稳定 detail panel。
- 大 dialog 必须受视口高度约束，并在内部滚动。
- 窄窗口下 list/detail grid 折叠为单列。

## 设置行

- 重复设置项使用左侧 row copy、右侧 control 的结构。
- 布尔设置优先使用整行 `<button role="switch">`，右侧 pill 只作为 `aria-hidden` 的视觉状态；设置页 switch 使用 `--semantic-settings-switch-*` 运行时 token，不复用按钮、segmented 或硬编码 accent 色。
- helper text 只在影响用户决策时保留。
- 长 provider/model 行优先使用 divider，不要每行都包重卡片。
- status、badge、control 出现时，row 高度必须稳定。

## Provider、Plugin、MCP、Skills 页面

- provider/model 列表是操作库存，应可搜索、可扫描、紧凑。
- 状态优先用 dot/icon/color；状态接近且容易混淆时再加文字。
- plugin 和 connector 详情页可以有更丰富媒体，但控件和元信息仍遵守桌面紧凑规则。
- global skills 编辑界面优先保证文档编辑、metadata 可读性和文件操作可预测。

## 管理型 List + Detail 组件

- list + detail 管理界面只消费运行时 token：page surface、list panel、detail panel、metadata table、info/review row、icon mark、form input 和 action button 都优先使用 `--semantic-settings-list-detail-*`、`--seg-*` 和状态语义 token；确实需要独立语义时再补组件自有的 `--semantic-<scope>-list-detail-*` token；不要硬编码 `#ffffff`、固定灰色、固定品牌色或 `rgba(...)`。
- list row 的 default、hover/focus、selected/current、disabled 状态必须成组定义。已有 sidebar/tree row 语义匹配时直接复用 `--semantic-sidebar-tree-row-*`；不匹配时先在 `tokens.css` 增加成对 light/dark 的 `--semantic-<scope>-list-detail-row-*-light/dark`，再暴露不带后缀的运行时 token。
- detail surface 使用无嵌套卡片的紧凑结构：主 detail panel 用 `--seg-panel`，次级信息块或 read-only row 用 `--seg-panel-muted`，分隔线和表格边框用 `--seg-border`，正文层级用 `--seg-text-1/2/3`。metadata table 用稳定两列 grid，长值必须 `min-width: 0` 并允许换行或截断。
- 状态表达使用 `--semantic-success-*`、`--semantic-warning-*`、`--semantic-error-*`、`--semantic-info-*` 和 `--text-tertiary`；dot、badge、helper/error text、invalid border 都不能写固定绿色、黄色、红色、蓝色或灰色。
- form input、copy/code field、action row 和 secondary/danger action 必须覆盖 default、hover/focus、disabled、error/invalid 状态。focus 用组件自身背景、边框、文字或指示器 token 表达，不使用额外 outline 或 inset ring。
- 组件需要跨多个业务复用时，规范和 token 命名使用组件语义，不使用业务名；业务页面只负责用局部 class 归属 CSS，不把业务色值或业务专属状态写进通用组件规则。

## 表单

- 只有两列都保持可读且控件自然对齐时才使用双列表单。
- 窄窗口表单折叠为单列。
- 有既有 settings/composer picker 模式时，使用 custom picker。
- 危险操作使用 semantic danger surface/text；不可逆操作需要明确确认。

## 空、加载、错误

- 空状态只给出下一步有用动作，不解释整套功能。
- 加载状态要预留布局空间，避免跳动。
- 错误信息要可操作，并放在失败控件或操作附近。
