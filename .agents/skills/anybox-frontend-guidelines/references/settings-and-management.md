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
- 布尔设置优先使用整行 `<button role="switch">`，右侧 pill 只作为 `aria-hidden` 的视觉状态；设置页 switch 与其他区域一样使用通用 `--semantic-switch-*` 运行时 token，不复用按钮、segmented 或硬编码 accent 色。
- helper text 只在影响用户决策时保留。
- 长 provider/model 行优先使用 divider，不要每行都包重卡片。
- status、badge、control 出现时，row 高度必须稳定。

## Provider、Plugin、MCP、Skills 页面

- provider/model 列表是操作库存，应可搜索、可扫描、紧凑。
- 状态优先用 dot/icon/color；状态接近且容易混淆时再加文字。
- plugin 和 connector 详情页可以有更丰富媒体，但控件和元信息仍遵守桌面紧凑规则。
- plugin marketplace 的占位图标底板、边框、文字、item hover surface、item border、state、tag 和 status 必须分别消费 `--semantic-plugin-market-*` runtime token；真实图片 Logo 保持资产原色且容器不绘制主题底色，图片缺失或加载失败才回退到中性字形/首字母占位；插件清单中的品牌色不得通过 `color-mix()` 派生这些组件颜色。
- global skills 编辑界面优先保证文档编辑、metadata 可读性和文件操作可预测。

## 管理型 List + Detail 组件

- 跨业务复用的 list + detail 行统一消费组件级运行时 token：行背景和文字使用 `--semantic-list-detail-row-*`，计数使用 `--semantic-list-detail-count-*`，紧凑前置图标使用 `--semantic-detail-icon-*`；page、list panel、detail panel、metadata table、form input 和 action button 继续按各自 surface、field、button 与状态语义选择 token，不要硬编码 `#ffffff`、固定灰色、固定品牌色或 `rgba(...)`。
- list row 的 default、hover/focus、selected/current、disabled 状态必须成组设计；hover/focus 使用 `--semantic-list-detail-row-surface-hover`，selected/current 使用 `--semantic-list-detail-row-surface-current` 与 `--semantic-list-detail-row-current-text`，不能让 current 退化为 hover。组件 CSS 只消费不带 `-light` / `-dark` 后缀的运行时 token；缺少状态时先在 schema v2 manifest 的通用 `semantic-list-detail-*` 家族补充成对 light/dark token 并运行生成器，不要新增业务前缀或在 `tokens.css` 另建颜色定义。
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
