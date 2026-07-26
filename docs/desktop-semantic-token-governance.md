# Anybox 桌面端 Semantic Token 治理规范（审阅草案）

更新日期：2026-07-25

状态：等待产品与设计审阅

## 1. 文档定位

本文定义 Anybox 桌面端颜色 token 的目标语义模型、命名规则、公开范围、复用边界、兼容策略和后续 UI 审计方法。

本文当前是规范草案，不代表现有前端已经符合全部规则。在本文完成审阅前：

- 不依据本文批量修改 manifest、CSS 或组件。
- 不依据默认色值相同就合并或删除 token。
- 不原地重命名公开 appearance token。
- 只把本文作为后续审阅和决策的共同入口。

主要事实来源：

- `packages/desktop/src/shared/appearance-token-manifest.json`
- `packages/desktop/scripts/generate-appearance-tokens.mjs`
- `packages/desktop/src/shared/appearance.ts`
- `packages/desktop/src/shared/appearance-themes.ts`
- `packages/desktop/src/renderer/src/styles/appearance-tokens.generated.css`
- `packages/desktop/src/renderer/src/styles/tokens.css`
- `packages/desktop/src/renderer/src/styles/*.css`
- `.agents/skills/anybox-frontend-guidelines/references/tokens-and-css.md`

当前实现的完整 Semantic Token 表格见
[`desktop-semantic-token-catalog.md`](./desktop-semantic-token-catalog.md)。

后续 UI 审计结果应写入独立文档 `docs/desktop-semantic-token-audit.md`，避免把持续变化的代码问题混入本规范。

### 1.1 结论标记

本文使用以下标记：

- **已确认**：最近讨论中已经明确接受，后续实现应遵守。
- **建议**：推荐作为目标规则，等待审阅确认。
- **待确认**：存在明确取舍，需要审阅者决定。
- **现状事实**：来自当前 manifest 或代码扫描，不代表目标设计。

## 2. 背景与当前基线

当前桌面端同时存在以下问题：

1. 部分 UI 消费了语义不匹配的 token，例如 Tag、功能图标或 Switch 内部元素跟随了通用 panel surface。
2. appearance 编辑器向用户暴露了较多组件实现级 semantic token，难以预测一个修改会影响哪些 UI。
3. 多个 token 拥有相同默认值，看起来重复，但其中既有真正重复，也有语义不同但暂时同色的情况。
4. 部分 semantic token 虽然名称独立，默认值仍 alias 到过宽的 foundation token，造成意外联动。
5. CSS 级联和高优先级 selector 可能覆盖正确 token，使代码声明与最终 computed style 不一致。
6. 一些名称包含过窄的页面位置，实际消费者却已经跨越多个管理型组件。
7. 公开 token 的重命名、合并或删除可能让已有用户主题失去覆盖值。

### 2.1 2026-07-25 基线快照

以下数字用于描述当前规模，不作为删减目标：

| 指标 | 当前值 | 说明 |
| --- | ---: | --- |
| Appearance 分组 | 29 | manifest 中的可编辑分组 |
| 可编辑 light/dark token 对 | 226 | 生成器当前报告值 |
| 与其他 token 共享 Terra 默认值的行 | 142 | 默认值相同不等于语义相同 |
| 静态扫描到直接消费者的 runtime token | 210 | 扫描 renderer CSS/TS/TSX，排除生成文件 |
| 静态扫描未发现直接消费者的 runtime token | 16 | 仍需排除动态消费、未来用途和兼容用途 |
| Legacy compatibility blend pairs | 96 | 只用于历史兼容 |
| 组件 CSS 中直接 `color-mix()` | 0 | 应持续保持为 0 |

这些数字说明当前主要问题不是简单的“存在大量完全没用的 token”。更可能的情况是：

- 合法的内部 semantic token 被不必要地暴露给用户。
- 不同 token 只是在默认主题下取值相同。
- 一部分 token 的 scope、名称或消费者已经偏离最初语义。
- 一部分 token 应合并，另一部分应保留但降级为 internal。

## 3. 治理目标

### 3.1 目标

- 用户能预测一个可编辑 token 会影响哪些 UI 角色。
- 组件只能消费与自身角色、属性和状态匹配的 runtime token。
- 同一 semantic token 的消费者应具有相同的视觉职责和状态生命周期。
- light 和 dark 模式具有明确成对值，不在组件 CSS 中处理模式差异。
- 品牌资产、状态色、交互色和普通 surface 之间边界清晰。
- 用户主题在 token 调整期间保持可迁移和可恢复。
- appearance 编辑器只展示对主题作者有意义的合同，不展示所有实现细节。

### 3.2 非目标

- 不以最少 token 数量为唯一目标。
- 不因为多个 token 当前颜色相同就强制合并。
- 不要求所有组件使用同一套 surface、border 或 foreground。
- 不让主题作者直接编辑内部 blend、兼容别名或临时迁移 token。
- 不通过一次大规模 CSS 替换完成全部迁移。
- 不在本规范审阅阶段修改现有 UI。

## 4. Token 分层模型

Token 的“代码层级”和“是否向用户展示”是两个独立维度。一个 token 可以是合法的 component semantic token，但仍然不应出现在普通 appearance 编辑器中。

### 4.1 Foundation token

Foundation token 描述基础视觉材料，不描述具体组件：

```text
surface-*
text-*
border-*
brand-*
```

允许直接消费 foundation token 的场景：

- 元素本身就是该基础角色，例如应用画布、shell、主要 panel 或正文文本。
- 元素没有独立交互状态。
- 改变该 foundation token 时，所有消费者理应一起变化。

不允许仅因为“当前颜色合适”就在控件中直接消费 foundation token。Button、Switch、Tag、badge、功能图标容器、状态提示和选中行必须优先使用 semantic token。

### 4.2 跨应用 Semantic token

跨应用 semantic token 表达多个区域共享的稳定角色：

```text
semantic-button-*
semantic-icon-button-*
semantic-success-*
semantic-warning-*
semantic-error-*
semantic-info-*
focus-outline-color
selection-background
```

只有角色、状态和可访问性要求一致时，多个组件才可共享这类 token。

### 4.3 Domain Semantic token

Domain semantic token 限定在一个稳定产品区域，但可以跨越该区域内的多个组件：

```text
semantic-sidebar-*
semantic-thread-*
semantic-markdown-*
semantic-composer-*
semantic-management-*
semantic-plugin-market-*
```

**建议**：Settings、Providers、Plugins、Connectors、MCP、Global Skills 等区域中，结构和交互一致的 list-detail 行应共享组件级 `semantic-list-detail-*`；只有确实属于管理域、且不适用于其他产品区域的角色才使用 `semantic-management-*`。

### 4.4 Component Semantic token

Component semantic token 描述一个控件或组件家族的属性和状态：

```text
semantic-settings-switch-track-surface-active
semantic-segmented-control-item-text-disabled
semantic-list-detail-row-surface-current
semantic-plugin-market-tag-surface
semantic-composer-icon-button-text-hover
```

有交互状态的组件应成组定义需要的状态，不能临时借用 accent、status 或 foundation token 填补缺口。

### 4.5 Internal derivation

Internal derivation 只解决 literal 或 alias 无法表达的受控派生：

- 只能由 manifest 生成。
- 不属于公开主题格式。
- 不直接展示给用户。
- 组件 CSS 不直接消费 `--mix-*`。
- 组件 CSS 不直接写 `color-mix()`。

### 4.6 Compatibility token

Compatibility token 只用于旧主题或旧消费者迁移：

- 不出现在 appearance 编辑器。
- 不用于新组件。
- 必须记录替代 token 和移除条件。
- 未完成主题迁移前不得直接删除。

## 5. Appearance 编辑器暴露等级

**建议**：为 appearance token 增加独立的暴露等级。具体 manifest 字段名称待实现阶段确定。

| 等级 | 用户可见性 | 使用条件 |
| --- | --- | --- |
| `core` | 默认展示 | 用户可以理解影响范围，并经常希望独立调整 |
| `advanced` | 高级区域折叠展示 | 有合法主题价值，但普通用户不需要频繁修改 |
| `internal` | 不展示 | 组件实现需要，但不构成用户主题合同 |
| `deprecated` | 不展示 | 仅保留导入、迁移或旧配置兼容 |

### 5.1 `core` 准入条件

一个 token 只有同时满足以下条件，才应默认展示：

1. 名称能让用户预测影响范围。
2. 修改它具有清晰、稳定的主题意义。
3. 不要求用户同时理解多个内部状态 token 才能得到可用结果。
4. 单独修改后仍能维持基本可读性。
5. 它不是另一个公开 token 的纯实现细节。

### 5.2 `advanced` 准入条件

适合高级展示的情况：

- 主题作者确实可能需要微调。
- 影响范围稳定，但属于组件状态矩阵。
- 默认可以通过 alias 得到合理值。
- 不应占据普通主题设置的主要层级。

### 5.3 应设为 `internal` 的情况

- hover/focus/disabled 等内部状态可以由公开角色稳定推导。
- token 只服务一个局部实现，用户无法从名称预测结果。
- token 必须与其他 token 成组调整，否则容易产生不可读主题。
- token 只是兼容层、局部桥接或迁移中间状态。

### 5.4 暴露等级与删除无关

把 token 设为 `internal` 不等于删除：

- CSS 仍可以消费它。
- manifest 仍可为 light/dark 定义值。
- 测试仍应覆盖它。
- appearance 编辑器不再把实现细节当作用户合同。

这应是减少“可设置 semantic token 看起来重复”的首选手段。

## 6. 命名规范

### 6.1 推荐结构

```text
semantic-{scope}-{role-or-component}-{property}[-{state}]
```

示例：

```css
--semantic-management-leading-icon-surface
--semantic-management-leading-icon-border
--semantic-management-leading-icon-foreground
--semantic-button-danger-surface-hover
--semantic-plugin-market-tag-text
```

### 6.2 Scope

Scope 应描述稳定的产品域，不描述偶然出现的页面：

| Scope | 覆盖范围 |
| --- | --- |
| 无 scope | 真正跨应用的组件或状态，例如 button、status |
| `management` | Settings、Provider、Plugin、Connector、MCP、Skills |
| `sidebar` | 左右侧栏和树状导航 |
| `thread` | ThreadView 与执行记录 |
| `markdown` | Markdown 内容 |
| `composer` | 输入区及其内部控件 |
| `plugin-market` | 插件目录、插件详情和插件元信息中的专属角色 |

当一个角色跨越多个独立组件，并且未来也应一起变化时，才提升 scope。不要只因为两个地方当前颜色一样就提升。

### 6.3 Property

| Property | 使用范围 |
| --- | --- |
| `surface` | 背景或填充 |
| `border` | 边框或分隔描边 |
| `text` | 明确的文字内容 |
| `foreground` | SVG、glyph、字母图标等非纯文字前景 |
| `indicator` | dot、进度、选择标记等指示器 |
| `shadow` | 确实属于组件语义的投影 |

**建议**：新建图标相关 token 使用 `foreground`，不再用 `text` 统称 SVG 和 glyph。旧 token 通过迁移逐步调整，不原地删除。

### 6.4 State

推荐状态词：

```text
hover
focus
active
selected
current
disabled
error
invalid
loading
```

规则：

- 默认状态通常省略 `default`。
- 需要完整矩阵的复杂组件可以保留 `default`，但同一家族必须一致。
- `active` 表示按下、打开或强调状态。
- `selected` 表示用户选择。
- `current` 表示导航或列表中的当前位置。
- `error` 表示运行结果或状态。
- `invalid` 表示输入校验。

### 6.5 禁止的命名依据

Token 名称不应依据：

- 当前色相：`red`、`blue`、`pink`。
- 当前透明度：`10-percent`、`faint-20`。
- 当前形状：`circle`、`square`、`pill`。
- 当前尺寸：`small`、`34px`。
- 单个页面的偶然位置：`top-left-red-box`。
- 当前引用来源：`panel-mixed-with-brand`。

形状、尺寸和布局属于组件 CSS；token 只描述视觉职责。

## 7. 复用、提升和新增决策

为一个 UI 选择 token 时，按以下顺序判断：

1. 这是品牌资产本身吗？
2. 这是基础 surface/text/border 吗？
3. 这是状态语义吗？
4. 这是有状态的交互控件吗？
5. 是否已有角色、属性、状态完全一致的 semantic token？
6. 该角色是否跨多个独立组件，并且未来应共同变化？
7. 如果只属于一个组件，是否需要 component semantic token？
8. 该 token 是否需要向主题作者公开？

### 7.1 品牌资产

品牌 Logo、品牌插图和明确的颜色样本：

- 使用资产原色。
- 不参与组件 surface、border、text 或 status 的运行时混合。
- 透明 Logo 的容器默认不绘制主题底色。
- 加载失败后才使用 token 化占位符。

### 7.2 提升为通用 token

满足以下条件时可以提升：

- 多个独立组件表达相同角色。
- 属性相同，例如都是 surface，而不是一个 surface 与一个 foreground。
- 状态生命周期相同。
- 对比度要求相同。
- 未来修改时理应一起变化。

如果只满足“默认颜色相同”，不得提升。

### 7.3 新增局部 token

以下情况适合保留 component/domain scope：

- 角色只在一个稳定组件家族中成立。
- 与通用 token 的状态或对比度要求不同。
- 未来可能独立调整。
- 复用通用 token 会让用户难以预测影响范围。

### 7.4 Foundation fallback

Semantic token 可以默认 alias 到 foundation token，但必须满足：

- alias 的联动符合语义。
- foundation 改变时，所有消费者理应一起变化。
- 该 alias 不只是为了获得一个当前看起来合适的颜色。

如果 semantic token 名称独立，但修改 foundation 后出现大量意外染色，则属于 **alias coupling**，应在审计中重新判断默认来源。

## 8. 合并、隐藏和删除标准

### 8.1 可以合并

两个 token 只有同时满足以下条件才能合并：

1. 角色相同。
2. 属性相同。
3. 状态相同。
4. 消费者拥有相同对比度要求。
5. 生命周期和维护责任相同。
6. 用户预期它们一起变化。

### 8.2 应保留但隐藏

以下 token 通常应改为 `internal`，而不是合并：

- 语义合法，但不需要用户独立设置。
- 与其他 token 同色，但未来允许独立演进。
- 组件状态矩阵中的辅助项。
- 用户无法安全地单独修改。

### 8.3 可以废弃

满足以下条件时进入 `deprecated`：

- 已有语义更准确的替代 token。
- 所有新代码已经禁止消费旧 token。
- 已定义旧主题迁移或兼容 alias。
- 已记录移除版本或移除条件。

### 8.4 可以删除

删除前必须确认：

- CSS、TS、TSX 和动态样式中无消费者。
- 内置主题和用户主题迁移均已完成。
- DTCG 导入导出不再需要旧名称。
- 生成文件、测试和文档均不再引用。
- 至少经过一个明确的兼容周期。

## 9. 已确认规则与近期示例

| 场景 | 当前结论 | 状态 |
| --- | --- | --- |
| 组件 CSS 直接 `color-mix()` | 必须保持为 0 | **已确认** |
| 插件品牌色参与 Tag、边框、状态色混合 | 禁止 | **已确认** |
| 真实插件 Logo | 保持资产原色，容器无主题底色、边框和方形阴影 | **已确认** |
| Logo 缺失或加载失败 | 使用独立占位 surface、border、foreground | **已确认** |
| 插件 Tag 背景 | 使用 `--semantic-plugin-market-tag-surface` | **已确认** |
| 插件 Tag 文字 | 使用 `--semantic-plugin-market-tag-text` | **已确认** |
| 危险操作按钮 | 使用完整 `--semantic-button-danger-*` 状态组 | **已确认** |
| Settings Switch | 轨道、边框、thumb 和状态使用 `--semantic-settings-switch-*` | **已确认** |
| 功能型前置图标 | 不应借用品牌 Logo 占位 token | **已确认** |
| 管理型功能图标通用名称 | 建议使用 `semantic-management-leading-icon-*` | **待确认** |
| 图标颜色属性名 | 新 token 建议使用 `foreground` 代替 `text` | **待确认** |
| Appearance 编辑器暴露等级 | 建议引入 core/advanced/internal/deprecated | **待确认** |

### 9.1 插件详情页示例

| UI | 当前或近期问题 | 目标语义 |
| --- | --- | --- |
| 真实 Chrome Logo | 透明区域露出 panel 调试色 | Logo 资产原色，容器不绘制 surface |
| CA/AP 等字母占位 | 与通用 panel 或品牌色耦合 | `semantic-plugin-market-icon-*` 占位 token |
| Plugin Tag | 继承通用 `.settings-badge` 的 panel surface | `semantic-plugin-market-tag-surface/text` |
| “包含内容”圆形功能图标 | 当前经局部变量落到 `surface-panel` | 建议迁移到 management leading icon token |
| 启用插件 Switch thumb | Semantic 名称正确，但默认 alias 仍可能跟随 panel | 审计 switch token 的默认 alias coupling |
| 卸载按钮 | 使用 danger button token | 保持现状 |
| 品牌颜色样本 | 显示清单原始品牌色 | 只作为颜色样本，不参与其他组件计算 |

## 10. 公开 Token 兼容策略

公开 appearance token 的 mode token 名称会进入用户主题 overrides 和 DTCG 文档。它们属于持久化合同。

因此禁止：

- 直接把旧 token 从 manifest 删除后改成新名字。
- 只迁移组件 CSS，不迁移用户主题。
- 让 v2 用户主题中的旧 token 变成 unknown token。
- 让旧 token 和新 token 同时长期显示在编辑器。

### 10.1 安全重命名流程

1. 在 manifest 中加入目标 token。
2. 为目标 token 定义 light/dark 值和 runtime alias。
3. 迁移组件消费者到目标 runtime token。
4. 将旧 token 标记为 deprecated，并从编辑器隐藏。
5. 为旧用户主题建立明确迁移规则或兼容 alias。
6. 验证 DTCG 导入、导出和主题库保存。
7. 经过兼容周期后再评估删除。

### 10.2 通用明细图标

```css
--semantic-detail-icon-surface
--semantic-detail-icon-border
--semantic-detail-icon-text
```

这三个 token 用于列表—详情界面中的非品牌紧凑前置图标和功能图标。其 light/dark
值必须是独立 literal，不得 alias 到 panel、brand 或其他组件 token，也不得通过
derivation / `color-mix()` 生成。调整面板色、品牌色或基础边框色时，不应联动这些图标。

使用前仍要区分：

- 非品牌功能图标。
- 品牌 Logo。
- Logo 占位符。
- 可点击 icon button。
- 状态 indicator。

只有第一类属于该目标 token。

## 11. 后续 UI 审计方法

本文通过审阅后，再创建 `docs/desktop-semantic-token-audit.md`。

### 11.1 审计单位

以组件家族为审计单位，不以单个 CSS 文件或单个 token 为单位：

1. Shell、window chrome、Dockview 和 pane。
2. Sidebar、tree row 和导航。
3. ThreadView、Markdown、trace 和 tool output。
4. Composer、menu、picker 和 utility controls。
5. Settings 基础控件。
6. Providers、Models、Plugins、Connectors、MCP、Skills。
7. Calendar、Automations、Cinema 和其他业务页面。
8. Button、Switch、Tag、badge、icon button、leading icon 等共享组件。

### 11.2 每个组件的检查顺序

1. 找到 React/TSX 组件与最终 class。
2. 找到全部匹配 CSS selector。
3. 读取浏览器最终 computed style。
4. 记录直接 runtime token。
5. 展开 alias 和 derivation 依赖。
6. 判断实际 UI 角色、属性和状态。
7. 对照本规范确定目标 token。
8. 检查 light/dark 和状态矩阵。
9. 记录迁移与兼容要求。

### 11.3 诊断主题

当前通过把某个 token 临时改成明显颜色来追踪消费者的方法应正式保留，但只作为审计工具：

- Foundation 诊断主题：为不同基础 surface 分配明显且互异的颜色。
- Semantic 诊断主题：为 Button、Switch、Tag、icon、status 等角色分配不同颜色。
- State 诊断主题：区分 default、hover、focus、active、disabled。

诊断时必须读取 computed style，不能只看截图推测来源。

诊断主题不进入生产默认主题，也不能通过运行时 `color-mix()` 生成。

### 11.4 问题分类

审计文档统一使用以下类型：

| 类型 | 含义 |
| --- | --- |
| `wrong-role` | 消费了语义错误的 token |
| `over-broad` | token scope 过宽，产生意外联动 |
| `over-specific` | token 名称过窄，但消费者已跨多个组件 |
| `alias-coupling` | semantic token 默认 alias 到不合理的 foundation |
| `duplicate-semantic` | 两个 token 角色、状态和生命周期完全重复 |
| `excessive-exposure` | 合法内部 token 被不必要地展示给用户 |
| `missing-semantic` | 组件缺少合法 semantic token |
| `incomplete-state` | 状态矩阵缺失或借用其他 token |
| `cascade-override` | 正确声明被更高优先级规则覆盖 |
| `brand-leakage` | 品牌色污染组件 surface、border、text 或 status |
| `hardcoded-color` | 组件 CSS 写固定颜色 |
| `legacy-consumer` | 新代码仍消费 compatibility 或 `--mix-*` |
| `orphan-token` | 无消费者且无兼容、未来或文档用途 |

### 11.5 审计表模板

| 区域 | 组件/Selector | UI 角色 | 属性/状态 | 当前 token | 目标 token | 问题类型 | 暴露等级 | 兼容要求 | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Plugins | `.plugins-included-icon` | leading icon | surface / border / text | `--semantic-detail-icon-*` | `--semantic-detail-icon-*` | — | editable | 旧名称保留兼容别名 | 已整改 |

### 11.6 Semantic Token Inspector

桌面端 Developer Mode 提供运行时 **Semantic Token Inspector / Authoring Editor**，用于确认浏览器实际采用的颜色声明和 token 链，并在开发源码运行时直接调整颜色语义。

使用方式：

1. 打开 `Settings → Developer Mode → Debug Overlays`。
2. 启用 `Semantic Token Inspector`。
3. 将鼠标移到目标 UI；浮层显示颜色属性、当前 token、computed value 和合规分类。
4. 点击悬浮卡中的任意颜色行会固定目标并打开“样式”；悬停后按 `Alt`、点击“固定详情”或 `Alt+点击` 也可固定。
5. 在“样式”中选择背景、前景、边框、图标、阴影等通道，再搜索并绑定合法的 runtime semantic token。`currentColor` 通道可以转到前景，也可以解除跟随后独立绑定。
6. 在 Token 颜色编辑器中同时设置 Light/Dark；这会临时覆盖页面中该 Token 的全部消费者。
7. 如果没有合适 Token，使用“新建 Token”确认推荐的 runtime 名称、语义分组、用途和 Light/Dark 初始值。
8. 所有操作先进入设计会话；使用撤销/重做，在“审阅变更”中确认 CSS、manifest 和生成文件摘要，再统一写回。
9. “检查”页继续显示 authored declaration、Token 链、selector 和源码位置；DOM 面包屑可以切换到父级目标。
10. 点击恢复按钮继续悬停检查，或按 `Esc` 完全退出。未保存会话会先要求确认放弃。

检查器读取 Chromium 当前匹配的 authored declaration，不根据最终 RGB 值反向猜测 token。多个 token 可以解析为同一颜色，因此颜色相同不能证明它们语义相同。

颜色通道状态：

| 状态 | 含义 |
| --- | --- |
| 显示中 | 当前 computed style 和关联属性表明该颜色正在产生视觉效果 |
| 未显示 | 通道存在但当前不渲染，例如 `border-width: 0`；绑定 Token 不会自动创建边框 |
| 未知 | 浏览器信息不足，或值的结构无法安全判断 |
| 只读 | 可以检查和临时预览，但不能安全定位并改写本地源码 |

运行时分类：

| 分类 | 含义 |
| --- | --- |
| 合规 | 组件直接使用已登记的 runtime semantic token |
| 间接合规 | 局部别名最终唯一指向 runtime semantic token |
| 警告 | 组件直接使用 foundation、brand 或 legacy token |
| 错误 | 直接使用 mode token、组件级字面颜色、硬编码 fallback 或运行时混色 |
| 信息 | CSS 语义关键字或图片资源 |
| 待确认 | 浏览器没有提供足够级联信息，检查器不会猜测唯一来源 |

写回模型：

- Renderer 只持有会话内的 opaque `editRef` / `ruleRef`，不能向主进程提交任意文件路径。
- `prepare` 会重新解析最新 CSS 与 JSONC manifest、验证引用和冲突、计算最小文本修改，并返回只存在于内存中的 review diff。
- `commit` 只接受 prepare 返回的 transaction ID；审阅期间任一相关文件变化都会返回 `stale`，不会覆盖新内容。
- 新 Token 的事务顺序为：创建 manifest row/group 和 Terra fallback、写入当前内置源码主题 override、最后修改 CSS binding。
- 写入使用快照和临时文件；appearance token generator 或 semantic catalog generator 失败时恢复全部源文件与生成文件。
- 成功后由 Vite HMR 刷新；Inspector 会重新检查绑定。验证超时时明确提示手动 reload。
- 不要求 Git clean，不执行 Git stage、commit 或 push，并保留 dirty 文件中的无关修改。

边界：

- Inspector 与当前窗口的 DevTools 互斥。DevTools 已打开时无法启用；运行中打开 DevTools 会自动退出 Inspector。
- 只有非打包的 Anybox renderer 源码运行时可写回；打包版、外部样式、generated CSS、`node_modules` 和无法唯一定位的声明均为只读。
- 可写路径严格限制在 `packages/desktop/src/renderer/src`，Token 定义只写 appearance manifest。
- 当前实际命中的 selector/state 是永久修改范围；当前 DOM 仅用于临时预览，不创建长期 inline style。
- Foundation、brand、legacy、mode token、`--mix-*` 和局部 Token 可检查，但不能作为新的组件绑定。
- 简单颜色声明、单色 shorthand 和可安全拆出的 longhand 可写回；复杂多重阴影、渐变、图片和 ambiguous/computed-only 声明只读。
- `<webview>`、canvas、xterm、原生菜单和系统标题栏只检查宿主元素，不进入内部绘制内容。
- 图片 Logo 只报告为资源；Logo 外层 fallback surface、border、foreground 仍按普通 CSS 属性检查。
- 第一版只处理颜色，不处理 spacing、radius、typography、尺寸、布局或 motion token。
- Inspector 自身使用隔离的 `--debug-token-inspector-*` 诊断色，以保证被检查主题损坏时工具仍然可读；这些颜色不属于产品主题合同。

## 12. 迁移阶段

### 阶段 0：规范审阅

- 审阅本文。
- 决定待确认事项。
- 暂停新增无文档依据的公开 semantic token。
- 不批量修改现有 UI。

### 阶段 1：Token inventory

- 从 manifest 生成完整 token 表。
- 建立 light/dark、alias、derivation 和 runtime dependency graph。
- 统计全部静态消费者和零消费者。
- 标注内置主题和用户主题覆盖。

### 阶段 2：组件审计

- 按第 11 节逐个组件家族检查。
- 记录 computed style 和诊断截图。
- 不在审计过程中随手创造新 token。

### 阶段 3：目标映射

- 为每个 token 标记 keep、promote、merge、internalize、deprecate 或 remove。
- 为每个错误消费者指定目标 token。
- 单独审阅所有公开 token 变化。

### 阶段 4：分批迁移

- 每批只处理一个组件家族或一个明确 token 家族。
- 同批更新 manifest、CSS、组件、测试和文档。
- 保留旧主题兼容。
- 每批进行 light/dark 和交互状态视觉 QA。

### 阶段 5：清理

- 移除已过兼容期的 deprecated token。
- 更新 appearance 编辑器分组。
- 更新 DTCG 导入导出说明。
- 固化自动检查。

## 13. 自动化与验收门槛

后续迁移应逐步建立以下检查：

- 组件 CSS 直接 `color-mix()` 数量必须为 0。
- 新组件不得消费 `--mix-*`。
- 组件不得使用带 `-light` / `-dark` 后缀的 mode token。
- 新增硬编码颜色数量不得上升。
- 所有公开 token 必须出现在治理或 token catalog 文档中。
- 所有 deprecated token 必须具有 replacement 和 migration。
- 所有新 token 必须具有至少一个合法消费者或明确的预留说明。
- Button、Switch、Segmented control 等状态组件必须具备完整状态矩阵。
- Runtime Inspector 不得通过 computed RGB 反推 token；无法唯一判定时必须保留 ambiguous 状态。
- 主题生成、类型检查和相关测试必须通过。

标准验证命令：

```powershell
cd C:\Projects\Anybox\packages\desktop
npm run appearance:tokens:check
npm run typecheck
npm test
```

## 14. 本轮需要审阅的决策

请优先审阅以下问题，不需要先逐个审阅 226 对 token：

1. 是否接受 Foundation / Cross-app Semantic / Domain Semantic / Component Semantic / Internal / Compatibility 的分层？
2. 是否接受 `core`、`advanced`、`internal`、`deprecated` 四级暴露策略？
3. 是否接受“默认值相同不构成合并依据”的合并标准？
4. 是否接受 `semantic-{scope}-{role/component}-{property}-{state}` 命名结构？
5. 是否接受新图标 token 使用 `foreground`，文字 token 使用 `text`？
6. 是否接受把跨 Settings、Plugins、Connectors、MCP、Skills 的通用角色提升到 `semantic-management-*`？
7. 是否接受 `semantic-management-leading-icon-*` 作为非品牌功能型前置图标的候选名称？
8. 是否接受公开 token 只能通过新增、迁移、deprecated、兼容期的方式重命名？
9. 是否接受规范与审计结果分成两份文档？
10. 是否接受本文通过前不批量修改现有 UI 和 token？

这些决策确认后，下一步才创建 token inventory 和组件审计文档。
