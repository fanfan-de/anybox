# Token 与 CSS

## Token 来源

`packages/desktop/src/renderer/src/styles/tokens.css` 是渲染层 token 的来源。新增样式前先消费已有 CSS 变量。

常用 token 家族：

- `--space-*`
- `--radius-control`、`--radius-chip`、`--radius-panel`、`--radius-overlay`
- `--surface-*`
- `--text-*`
- `--border-*`
- `--shadow-*`
- `--brand-*`
- `--semantic-*`
- 兼容旧样式的 `--seg-*`
- 预计算混合色 `--mix-*`

## 主题规则

- 组件样式使用不带 `-light` / `-dark` 后缀的运行时 token。
- 只有缺少可复用语义 token 时，才在 `tokens.css` 里补充成对的 light/dark 值。
- 已有等价 surface、text、border、semantic、brand 或 mix token 时，不要硬编码颜色。
- 如果被修改区域附近仍有历史硬编码颜色，优先顺手迁移到 token，不要继续扩大硬编码集合。
- light/dark 差异放在 token 层表达：定义 `--semantic-*-light` 与 `--semantic-*-dark`，再把运行时 `--semantic-*` 在默认 `:root` 和 `:root[data-theme="dark"]` 中分别指向对应值。
- 组件 CSS 不直接写 `:root[data-theme="dark"] .component...`，除非正在适配第三方库、浏览器控件或无法通过 token 表达的特殊资产。
- 新增语义 token 前先查找已有 `--semantic-*`、`--surface-*`、`--text-*`、`--border-*`、`--mix-*` 是否已能表达同一含义；确实缺失时再补成对 light/dark 值。
- 按钮状态必须使用按钮语义 token。每个按钮变体都需要成组定义 surface、hover surface、border、hover border、text、hover text、disabled surface、disabled border、disabled text，命名使用 `--semantic-button-<variant>-*`。不要用 `--seg-accent`、品牌 accent token 或 status token 代替按钮 token，因为这些 token 可能面向文字、图标或状态提示，不保证按钮 default/hover/disabled 在 dark 主题下的对比度。
- 主题相关 UI 修改完成后必须检查 light 和 dark 两种主题，尤其是 active、hover、focus、disabled、selected、empty/error 状态，避免某个状态仍露出白底或低对比文本。

## CSS 归属

- `tokens.css`：主题变量和可复用语义值。
- `base.css`、`index.css`、`motion.css`：基础 reset、全局 wiring、广义动效规则。
- `shell.css`：window shell、app grid、rails、顶层 chrome。
- `sidebar.css`：左右侧栏、workspace/session tree、skills tree、context menu。
- `workbench.css`：canvas、panes、tabs、workbench layout、canvas top menu。
- `thread.css`：ThreadView、assistant/user turns、trace items、权限提示、side chat、markdown。
- `composer.css`：composer、utility bar、branch/model menus、command menus。
- `settings.css`：settings、plugins、connectors、MCP、provider/model 管理。
- `responsive.css`：跨区域响应式覆盖规则。

新规则放到最窄的归属文件里。不要为了省事增加宽泛的后置 override；优先使用局部 selector、组件 class 或 token。

## CSS 实现规则

- 使用语义 class，避免过重的元素级 selector 链。
- 覆盖规则必须作用域明确，例如 `.composer ...`、`.sidebar ...`、`.settings-page-main.is-services ...`。
- icon button、toolbar 控件使用明确的 `width`、`height`、`min-width`、`min-height`。
- focus 使用组件自身的背景、边框、文字或指示器 token 表达；不使用 outline 或 inset ring。
- 参与滚动或截断的 grid/flex 子项设置 `min-height: 0` 和 `min-width: 0`。
- 遵守 `prefers-reduced-motion`。动效不能成为理解状态的唯一方式。
