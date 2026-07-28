# Token 与 CSS

## Token 来源

可编辑的 appearance token、light/dark 配对、runtime token 名称、编辑器分组、品牌值和内置主题统一定义在：

- `packages/desktop/src/shared/appearance-token-manifest.json`

修改 manifest 后运行：

```powershell
npm run appearance:tokens:generate
npm run appearance:tokens:check
```

以下文件是生成物，禁止手工修改：

- `src/shared/appearance-tokens.generated.ts`
- `src/renderer/src/styles/appearance-tokens.generated.css`

`src/renderer/src/styles/tokens.css` 只承载排版、尺寸、阴影和旧命名兼容别名。它不是可编辑 appearance token 的第二来源，也不再定义 `--mix-*`。

manifest 使用 schema v2。公开 token 值只允许两种表达：

- `literal`：DTCG color 结构值；manifest 源值统一使用 `srgb`。
- `alias`：引用另一个已注册的 light/dark mode token。

`blend` 只允许出现在 manifest 的内部 `derivations` 中，固定为两个来源、`srgb` 混合空间且权重合计 100。它不是公开主题格式，也不能由设置页或 DTCG 导入直接写入。这样既保留少量确有必要的透明度/状态派生，又避免把颜色计算散落到组件和用户配置。

新增样式前先消费已有 runtime CSS 变量。常用 token 家族：

- `--space-*`
- `--radius-control`、`--radius-chip`、`--radius-panel`、`--radius-overlay`
- `--surface-*`
- `--text-*`
- `--border-*`
- `--shadow-*`
- `--brand-*`
- `--semantic-*`
- 兼容旧样式的 `--seg-*`
- 仅供旧代码过渡的 `--mix-*`（禁止新增消费）

## 组件语义所有权

组件必须服从与自身交互职责对应的完整 semantic token 组合，而不是只挑一个视觉上接近的 token：

- 先按行为、状态模型和 ARIA role 判断组件类型，再选择 manifest 中对应的 component/product token 组。class 名称、所在页面、相邻组件或复用的 shared CSS 不能改变 semantic token 归属。
- 组件必须消费对应组中所有适用状态，例如 default、hover、focus、active、selected/current、disabled、invalid/error 的 surface、border、text、icon、meta text。组内已经存在专用 token 时，组件不得绕过它直接消费 `--surface-*`、`--text-*`、`--border-*`、`--brand-*`、`--seg-*` 或其他组件的 `--semantic-*` token。
- 组合组件按子部件分别归属：picker trigger 属于 button/menu-trigger，搜索输入属于 field，展开面板和选项属于 dropdown select；每个子部件只消费自己的状态组合。
- 可以复用 shared class 的布局、尺寸、排版、圆角、阴影、定位和键盘行为，但不能因此继承错误组件的颜色状态。选择型 listbox 即使复用 context-menu 行结构，也必须覆盖为 dropdown option token；动作菜单不能反向借用 selected option token。
- 允许区域局部变量作为一对一语义别名，例如 `--project-picker-option-hover: var(--semantic-dropdown-option-surface-hover)`；禁止把局部变量映射到基础色、兼容别名或其他组件组后伪装成本组件语义。manifest 内部由 semantic mode token alias 到基础 token 不受此限制。
- 对应 semantic 组没有定义的非颜色属性，才可继续使用通用 spacing、radius、shadow、motion 等结构 token；不要为了追求形式上的全组件专用而复制这些基础 token。
- 新增或扩充 semantic token 组时，必须使用 `rg` 等方式盘点相同交互角色、ARIA role、组件 class、局部变量和旧 token 的全部消费者。所有命中项要么在同一改动中迁移，要么记录有理由、可追踪的例外。
- 测试必须同时包含正向和负向断言：确认代表性消费者使用完整的对应 token 组合，并确认该组件没有通过基础 token、兼容别名、局部变量或其他组件组回退。

## 主题规则

- 组件样式使用不带 `-light` / `-dark` 后缀的运行时 token。
- 只有缺少可复用语义 token 时，才在 manifest 中补充 light/dark 配对、runtime 名称和编辑器归属，再重新生成产物。
- 已有等价 surface、text、border、semantic 或 brand token 时，不要硬编码颜色。
- 如果被修改区域附近仍有历史硬编码颜色，优先顺手迁移到 token，不要继续扩大硬编码集合。
- light/dark 差异放在 manifest 中表达；生成器负责输出 `--semantic-*-light`、`--semantic-*-dark` 和默认/system/显式 dark 三套 runtime alias。
- 组件 CSS 不直接写 `:root[data-theme="dark"] .component...`，除非正在适配第三方库、浏览器控件或无法通过 token 表达的特殊资产。
- 新增语义 token 前先查找已有 `--semantic-*`、`--surface-*`、`--text-*`、`--border-*` 是否已能表达同一含义；确实缺失时再向 manifest 补充成对 light/dark 值。
- 新组件 CSS 禁止直接消费 `--mix-*`。现存直接消费由 manifest 兼容白名单冻结，应该在相关区域重构时逐步替换成具名 semantic token。
- 只有当一个颜色必须随两个基础 token 联动，且 literal/alias 都无法正确表达时，才新增内部 derivation；优先让组件消费具名 semantic runtime token，而不是 derivation 名称。
- 组件 CSS 禁止直接使用 `color-mix()`，不为插件品牌色、代码高亮色、`currentColor` 或其他运行期局部值保留例外。需要不同颜色角色时，先定义明确的 light/dark semantic token，再由组件消费不带模式后缀的 runtime token。插件品牌色只能作为原始品牌色、图标资产或颜色样本展示，不能参与组件背景、边框、文字或状态色的运行时混合。
- 按钮状态必须使用按钮语义 token。每个按钮变体都需要成组定义 surface、hover surface、border、hover border、text、hover text、disabled surface、disabled border、disabled text，命名使用 `--semantic-button-<variant>-*`。不要用 `--seg-accent`、品牌 accent token 或 status token 代替按钮 token，因为这些 token 可能面向文字、图标或状态提示，不保证按钮 default/hover/disabled 在 dark 主题下的对比度。
- 主题相关 UI 修改完成后必须检查 light 和 dark 两种主题，尤其是 active、hover、focus、disabled、selected、empty/error 状态，避免某个状态仍露出白底或低对比文本。

## CSS 归属

- `appearance-token-manifest.json`：可编辑 appearance token、编辑器元数据、品牌值和内置主题的唯一来源。
- `appearance-tokens.generated.css`：由 manifest 生成的 mode token、内部 derivation 和 runtime alias。
- `tokens.css`：排版、尺寸、阴影、旧命名兼容别名以及其他非 appearance token。
- `base.css`、`index.css`、`motion.css`：基础 reset、全局 wiring、广义动效规则。
- `shell.css`：window shell、app grid、rails、顶层 chrome。
- `sidebar.css`：左右侧栏、workspace/session tree、skills tree、context menu。
- `workbench.css`：canvas、panes、tabs、workbench layout、canvas top menu。
- `thread.css`：ThreadView、assistant/user turns、trace items、权限提示、branch actions、markdown。
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
