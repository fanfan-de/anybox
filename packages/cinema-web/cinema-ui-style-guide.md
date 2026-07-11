# Cinema Web UI Style Guide 草案

日期：2026-07-10

适用范围：`packages/cinema-web` 的 React/Vite 前端界面，包括节点画布、生成节点、文件面板、右键菜单、画布导航，以及后续剪辑台界面。

这份文档先基于当前实现做样式审计，再给出第一版可执行 UI 标准。当前事实来源为：

- `src/App.tsx`
- `src/styles.css`
- `cinema-timeline-editor-design.md`

## 1. 样式审计

### 1.1 当前界面结构

当前 Cinema Web 是一个深色画布式创作工具，不是普通页面应用。主要 UI 由以下模块组成：

| 区域 | 代码入口 | 现有样式前缀 | 说明 |
| --- | --- | --- | --- |
| 外层 shell 和画布 | `App` | `cinema-shell`、`cinema-workspace`、`cinema-canvas` | 全屏、无页面滚动、ReactFlow 画布承载主体验 |
| 文本节点 | `TextCanvasNode` | `cinema-text-*` | 独立布局，包含文本编辑区、悬浮工具条、文本生成器 |
| 图片节点 | `ImageCanvasNode` | `cinema-image-*` | 统一承载上传、AI 生成、候选确认、最终图片预览和裁剪 |
| 视频生成节点 | `VideoGenerationCanvasNode` | `cinema-video-gen-*` | 视频预览、模式 tab、provider/model/参数控件 |
| 音频节点 | `AudioCanvasNode` | `cinema-asset-ready-*` | 音频空状态、素材引用和播放预览 |
| 文件面板 | `ProjectFileBrowser` | `cinema-file-*` | 右侧浮层文件浏览器，包含面包屑、文件列表、预览区 |
| 素材库面板 | `AssetLibraryPanel` | `cinema-asset-library-*` | 独立右侧浮层；项目/个人域、物理文件夹、搜索、上传、多选、预览和 Canvas 引用入口 |
| 素材 Ready 节点 | `ImageReadyState`、`VideoReadyState`、`AudioCanvasNode` | `cinema-asset-ready-*` | 统一读取 canonical `assetRef`；只有输出 Handle，不出现生成 Composer |
| 右键菜单 | `ContextMenu`、`NodeContextMenu` | `cinema-context-menu` | 空白处只新增 Text、Image、Video、Audio；单节点查看详情，多选组选区删除 |
| 垂直导航 | `CanvasPanelNavigation` | `cinema-canvas-nav-*` | 项目文件与素材库是两个互斥入口；任一入口打开时关闭 Inspector |
| 第三方画布控件 | ReactFlow | `react-flow__*` | Controls、MiniMap、Handle 的局部覆盖 |

### 1.2 当前视觉基调

当前界面已经形成了相对一致的方向：

- 深色生产工具界面，强调画布、节点和素材，而不是装饰。
- 面板化、紧凑、控件密度较高。
- 节点使用 8px 左右圆角，靠细边框和中等阴影区分层级。
- 大部分操作是 icon-only 或紧凑控件，符合桌面工具预期。
- ReactFlow controls、文件面板、右键菜单、生成器 composer 都使用半透明深色 surface。

需要保留的方向：

- 第一屏直接是可用工具，不引入 landing page、hero、营销式说明区。
- 节点和面板继续使用低装饰的工具界面语言。
- 状态反馈优先用 icon、spinner、progress、细边框和局部颜色，不用大面积强调色。

### 1.3 Token 现状

`src/styles.css` 顶部已有这些运行时 token：

```css
--cinema-surface
--cinema-surface-2
--cinema-surface-3
--cinema-canvas-bg
--cinema-text-node-surface
--cinema-text-node-surface-2
--cinema-text-node-toolbar
--cinema-text-node-border
--cinema-text-node-border-soft
--cinema-border
--cinema-border-strong
--cinema-text
--cinema-text-2
--cinema-text-3
--cinema-danger
```

审计结果：

- `styles.css` 约 1858 行。
- 当前有 44 个 hex 颜色引用。
- 当前有 69 个 `rgba(...)` 引用。
- 当前有 14 个 `color-mix(...)` 引用。
- 当前有 20 处 `box-shadow` 引用。
- 当前有 3 处 `backdrop-filter` 引用。
- 当前有 2 个 `@media`，1 个 `@container`。

结论：

- 已经有 token 基础，但 token 粒度不足，导致控件状态、surface 层级、状态色、阴影和透明色仍大量硬编码。
- 当前 token 只有暗色主题，没有 light/dark 成对映射。后续如果 Cinema Web 要嵌回 Anybox 主 UI，主题兼容会成为成本。
- `NODE_META` 中的节点 accent 目前写在 `src/App.tsx` 的 hex 字符串里，适合作为第一批迁移目标。

### 1.4 颜色和状态问题

当前硬编码颜色主要分布在：

- 全局根色、surface 和文字 token 定义。
- ReactFlow controls、MiniMap、节点、文件面板、右键菜单的半透明背景。
- 按钮 hover/focus 的白色透明背景。
- 提交按钮的浅色填充和深色文字。
- running/succeeded/failed 状态色。
- 预览区 checkerboard 背景、overlay、阴影。
- `NODE_META` 的节点类型 accent。

风险：

- 新增 UI 容易继续复制 `rgba(255, 255, 255, ...)`，导致同一状态在不同 surface 上对比不一致。
- 成功、运行中、危险状态没有完整 token 矩阵，只在局部写颜色。
- 当前 submit button 以 `var(--cinema-text)` 作为浅色填充，语义不清。文字 token 不应该承担按钮 surface 的职责。
- focus 大多能看到，但缺少统一的 focus token。部分控件只移除 outline，依赖 hover 同款背景变化。

### 1.5 布局和密度

做得好的地方：

- 主体布局全部锁在 100% 宽高，适合画布工具。
- `min-width: 0`、`min-height: 0` 使用较多，长内容和滚动容器比较稳。
- icon button、submit button、缩略图、导航按钮大多有明确尺寸。
- 文件面板有窄屏覆盖，移动到左侧并隐藏预览区。
- 视频节点使用 `container-type: size` 和 `@container`，这是可继续沿用的局部响应式方式。

需要收敛的地方：

- 节点最小宽高、composer 高度、控件列宽目前散落在各组件样式中。后续新增 timeline UI 时需要统一密度尺度。
- 表单列宽使用局部 grid 值，例如 `92px 52px 34px`、`70px 64px 76px 34px`，需要在规范里明确哪些是固定控件、哪些可伸缩。
- 文件面板、右键菜单、文本模型菜单都各自定义 overlay surface，后续应合并到 overlay token。

### 1.6 控件和交互状态

做得好的地方：

- 操作基本使用真实 `<button>`。
- 多数 icon-only button 有 `title` 或 `aria-label`。
- 进度条使用 `role="progressbar"`，错误信息使用 `role="alert"`。
- 文本模型菜单使用 `role="listbox"` 和 `role="option"`。
- 视频模式切换使用 `role="tablist"` 和 `role="tab"`。
- 右键菜单使用 `role="menu"` 和 `role="menuitem"`。

需要补齐的地方：

- 右键菜单 button 只有 hover，没有 `:focus-visible` 样式。
- ReactFlow controls button 只有 hover，没有统一 focus 样式。
- 部分自定义 listbox/menu 缺少键盘 arrow navigation 约束，规范需要先明确目标。
- 原生 `select` 在图片/视频生成控件里直接使用，目前可以接受，但后续如果和 Anybox 主 UI 对齐，应迁移为统一 picker。
- submit、secondary、danger、toolbar、row action 的按钮语义没有抽成稳定规则，后续新 UI 容易发散。

### 1.7 文本、截断和长内容

做得好的地方：

- 文件名、路径、状态、模型名、节点标题大量使用 ellipsis。
- 错误信息使用 `overflow-wrap: anywhere` 和两行 clamp，能处理长错误。
- 文件 browser header、文件 row、节点 header 都有 `min-width: 0`。

风险：

- 多数 UI 文案是英文，少数导航和 tooltip 是中文。当前产品语言需要统一策略。
- uppercase label 只出现在文件面板标题，`letter-spacing: 0` 已符合要求。
- 文本节点 toolbar 混合了图标和短文字，中文环境下仍需检查最长文案是否溢出。

### 1.8 动效和性能

当前动效很少：

- spinner 使用 `cinema-spin`。
- progress indeterminate 使用 `cinema-progress-indeterminate`。
- 进度条宽度有 `transition: width 180ms ease`。
- 已有 `prefers-reduced-motion: reduce` 覆盖。

结论：

- 当前动效克制，符合工具界面。
- 后续 timeline 拖动、播放头、clip resize 不应通过 transform/scale 制造装饰动效。动效只服务状态理解和操作反馈。

## 2. 产品和视觉原则

Cinema Web 的 UI 标准：

- 做成安静、成熟、克制的桌面创作工具。
- 优先服务创作编排、素材扫描、节点编辑和重复操作效率。
- 画布、节点、素材和预览是主角，装饰不是主角。
- 不做 landing page、hero page、装饰型 dashboard、玻璃拟态、大面积渐变或大面积品牌色。
- 卡片只用于节点、重复素材项、模态框和确实需要框住的工具，不做卡片套卡片。
- 界面默认紧凑。标题、按钮、面板 header 都使用工具界面尺度，不使用页面 hero 尺度。

## 3. Token 标准

### 3.1 Token 分层

后续 `cinema-web` 样式应按以下 token 层级组织。

基础 token：

```css
--cinema-color-*
--cinema-space-*
--cinema-radius-*
--cinema-shadow-*
```

语义 token：

```css
--cinema-surface-*
--cinema-text-*
--cinema-border-*
--cinema-control-*
--cinema-button-*
--cinema-status-*
--cinema-overlay-*
--cinema-node-*
```

组件只消费语义 token，不直接消费基础颜色。组件 CSS 不写 `-light` 或 `-dark` 后缀 token。

### 3.2 第一批建议补齐的 token

当前不要求一次性改完 CSS，但后续迁移建议先补这些 token：

| 目标 token | 用途 |
| --- | --- |
| `--cinema-surface-canvas` | 画布背景 |
| `--cinema-surface-panel` | 普通节点和面板 |
| `--cinema-surface-panel-raised` | 浮层、文件面板、菜单 |
| `--cinema-surface-panel-hover` | hover row、hover button 背景 |
| `--cinema-surface-panel-active` | selected/current/toggled 背景 |
| `--cinema-surface-input` | textarea/input/select 背景 |
| `--cinema-surface-preview` | 图片/视频预览底 |
| `--cinema-text-primary` | 主文本 |
| `--cinema-text-secondary` | 次级文本 |
| `--cinema-text-muted` | 弱文本、placeholder |
| `--cinema-border-subtle` | 常规边框 |
| `--cinema-border-strong` | hover/focus/selected 边框 |
| `--cinema-border-focus` | focus-visible 边框 |
| `--cinema-status-danger-*` | 危险状态 surface/text/border |
| `--cinema-status-success-*` | 成功状态 surface/text/border |
| `--cinema-status-progress-*` | queued/running 状态 surface/text/border |
| `--cinema-button-primary-*` | 主按钮完整状态矩阵 |
| `--cinema-button-secondary-*` | 次按钮完整状态矩阵 |
| `--cinema-button-danger-*` | 危险按钮完整状态矩阵 |
| `--cinema-button-toolbar-*` | toolbar/icon button 状态矩阵 |
| `--cinema-overlay-surface` | 菜单、popover、右侧浮层 |
| `--cinema-overlay-border` | overlay 边框 |
| `--cinema-overlay-shadow` | overlay 阴影 |

### 3.3 颜色硬编码规则

新增或修改样式时：

- 不在组件规则里新增 hex、固定灰色、固定白色、固定黑色或 `rgba(...)`。
- 不把 `--cinema-text` 当作按钮填充色使用。按钮必须消费 button token。
- 不把 danger/success/progress 状态色直接当成按钮 token。状态提示和按钮状态分开。
- 缺少 token 时先补 token，再写组件规则。
- 动态节点 accent 可以暂时保留 `--node-accent` 运行时变量，但 accent palette 应迁移成命名 token。

允许例外：

- 第三方库无法 token 化的局部覆盖。
- Canvas、checkerboard、媒体预览等确实依赖图案的局部背景，但仍要尽量通过 token 表达颜色。
- 临时 prototype 可以硬编码，但合并到主线前必须迁移。

### 3.4 主题规则

第一版仍以暗色主题为主，但新 token 必须为 light/dark 兼容留出结构：

```css
:root {
  --cinema-surface-panel-light: ...;
  --cinema-surface-panel-dark: ...;
  --cinema-surface-panel: var(--cinema-surface-panel-dark);
}

:root[data-theme="light"] {
  --cinema-surface-panel: var(--cinema-surface-panel-light);
}
```

组件 CSS 只能使用 `--cinema-surface-panel` 这种运行时 token，不直接读取 `--cinema-surface-panel-light` 或 `--cinema-surface-panel-dark`。

## 4. CSS 组织规则

当前只有 `src/styles.css` 一个样式文件。短期可以继续使用，但必须按区域组织，新增规则放到最窄区域附近。

推荐顺序：

1. Root token
2. Base reset
3. Shell/canvas
4. ReactFlow overrides
5. Shared node primitives
6. Text node
7. Image node
8. Video generation node
9. Canvas navigation
10. File browser
11. Empty/error states
12. Context menu
13. Motion
14. Responsive

规则：

- class 使用 `cinema-` 前缀。
- 组件 class 使用 `cinema-<surface>-<element>`。
- 状态使用 `is-*`，例如 `is-selected`、`is-active`、`is-error`、`is-running`。
- 避免宽泛后置 override。
- 不新增和现有命名平行但视觉不兼容的一次性按钮 class。
- 参与滚动、截断或 grid/flex 收缩的子项必须设置 `min-width: 0`，需要时设置 `min-height: 0`。

## 5. 组件标准

### 5.1 Shell 和 Canvas

标准：

- `cinema-shell` 始终是全屏工具容器，禁止页面级纵向滚动。
- `cinema-workspace` 和 `cinema-canvas` 必须保持 `min-width: 0`、`min-height: 0`。
- ReactFlow 画布背景使用 canvas surface token。
- `Background`、`MiniMap`、`Controls` 的颜色应通过 token 控制。
- 新增浮层必须确认不会被画布容器裁剪。需要跨层级时使用 fixed 或 portal。

禁止：

- 在画布上添加装饰性渐变、光斑或大面积插画背景。
- 通过 hover 改变画布控件尺寸。

### 5.2 节点卡片

标准：

- 节点是主要信息容器，允许使用 8px 圆角、细边框、中等阴影。
- 节点 selected 状态使用 accent 边框和轻量 halo，不改变节点尺寸。
- Ctrl/Cmd 点击用于追加或取消节点，空白区左键拖动用于框选，中键拖动用于平移；多选后可从组选框或任一已选节点直接拖动整组。
- 多选节点全部保留 selected 视觉，但只有唯一 active 节点可以挂载编辑器、生成器或 Inspector；多选状态不同时打开多套浮层。
- Delete / Backspace 删除整个选择集合；输入框、文本域或节点编辑态必须继续拦截删除快捷键。
- 多选区域或任一已选节点的右键菜单提供危险操作“删除”，一次删除打开菜单时捕获的完整节点集合。
- 节点 header 保持紧凑，主标题 ellipsis。
- delete row action 默认隐藏，在 hover、selected、focus-visible 时显示。
- 节点 body 的预览、编辑器、生成器都要设置稳定尺寸或 grid 轨道，避免 loading/错误文案导致布局跳动。

节点类型 accent：

- 保留每种节点类型有稳定 accent 的模式。
- accent 不用于大面积背景，只用于 icon、handle、selected border、progress fill 等小面积识别。
- 后续将 `NODE_META.accent` 迁移为命名 token，例如 `--cinema-node-accent-text`、`--cinema-node-accent-image`。

### 5.3 Text Node

标准：

- Text 节点同时承载手写与 AI 生成，但节点本体始终以正文阅读为主；单击选择后在节点下方直接显示生成 Composer，双击正文或按 Enter 进入编辑。
- 非编辑态的正文预览属于节点拖拽面，用户可以从正文区域直接拖动节点；只有进入 textarea 编辑态后才阻止节点拖拽，以保留文字选择和输入。
- 节点宽度固定为 360px，高度按正文从 4 行增长到最多 12 行，超出后正文内部滚动；动态高度不写回 Canvas schema。
- header 只保留状态与更多操作；复制、下载、重命名和删除放入可键盘导航的更多菜单。手动编辑由正文双击或键盘 Enter 触发，AI 生成入口由选中态 Composer 承载。
- 空节点显示轻量类型图标和“输入文本”提示；复制和下载在正文为空时禁用，不得复制 placeholder。
- 生成器使用 screen-space 浮层，始终水平居中固定在节点下方；不得根据视口做左右钳制、上下翻转或切换为底部抽屉，允许随节点一起离开可视区域。
- 生成期间保留旧正文且禁止编辑；成功后以生成结果替换正文，并提供 8 秒的一次性恢复入口。
- 左侧端口只接收 AI 生成用的图片参考素材；右侧文本输出允许一对多连接到兼容的图片和视频输入。
- 输入和 textarea 保留原生编辑行为和原生右键菜单。
- 文本生成器错误最多显示两行，长错误允许 `overflow-wrap: anywhere`。
- Text 节点及生成器文案使用全局 i18n helper；界面语言由左上角 Settings 中的语言选项控制，首次使用跟随系统语言，当前资源覆盖 `zh-CN` 与 `en-US`。

注意：

- Text 节点 default、selected、focus、disabled、generating、failed、overlay 和 menu 状态只消费运行时 semantic token，light/dark 差异在 token 映射层表达。
- 不为 Text 节点引入语义缩放；各缩放级别保持相同内容结构。

### 5.4 Image Node

标准：

- 用户可见和新建的图片节点只有一种：`image`。上传、AI 生成和裁剪是资产来源，不是独立节点类型。
- 节点宽度保持约 300px；Empty 使用稳定 1:1 frame，获得资产后按最终图片自然宽高比展示，状态切换不改变 header 和 handle 的锚点。
- Empty 节点未选中时只显示标题和占位 frame；选中或键盘打开后，上方显示上传命令，下方显示生成 composer。点击画布空白或按 `Escape` 收起控制区并把焦点还给节点。
- Uploading / Generating 状态隐藏上传和 composer，以稳定占位、spinner 或 progress 表达过程，并禁用重复提交。失败后回到可重试的 Empty UI，错误信息使用 `role="alert"`。
- 单图生成结果直接成为最终 `asset`；多图结果进入 Choosing，当前候选显示在主预览，缩略图使用 `radiogroup` / `radio` 语义，并且只有一个主操作“使用此图片”。
- Ready 状态只显示最终图片；选中后只出现裁剪工具，不再提供上传、替换、重新生成或版本切换。预览加载失败仍保持 Ready 的锁定语义，并禁用裁剪。
- 裁剪 Apply 创建新的 Ready `image` 节点并保留来源边；Cancel / Reset 不改变源节点。
- 图片来源、文件名、prompt、模型、任务和裁剪来源放在 Inspector 展示；画布节点不增加常驻来源 badge。路径和文件名使用单行 ellipsis，完整值通过 `title` 暴露。
- Handle 默认隐藏，在 hover、selected、focus-within 时显示；已有来源边保持可见。只有 Empty 状态允许新增左侧连接，右侧可以连接，但下游只能消费最终 `asset`。
- 上传按钮和 composer 是脱离 React Flow 节点测量的 overlay。Composer 始终水平居中固定在节点下方，不因节点靠近视口边缘而改变位置或自动平移画布。
- 图片生成 Composer 未展开高级设置时，底部配置固定为单行，顺序为模型、画布规格摘要、数量、高级入口和生成操作。画布规格摘要始终显示当前宽高比与分辨率，点击后通过 portal/fixed 锚定二级面板编辑；面板支持视口边缘避让、`Escape` 关闭和焦点恢复。高级面板展开在该固定配置行上方。
- 图片节点的 `default`、`hover`、`focus`、`selected`、`loading`、`choosing`、`ready`、`error` 和 `disabled` 状态都必须消费运行时 semantic token；缺少 token 时先补成对 light/dark 映射。

数据与状态约束：

- `data.asset` 是唯一可被下游消费的最终资产；`data.candidateAssets` 仅用于确认前的候选集合，`selectedCandidateAssetID` 只表示当前预览。
- `sourceKind` 只允许 `upload`、`generation`、`crop`。状态由 `asset`、`candidateAssets` 和任务状态推导，不额外持久化 UI 状态枚举。
- 旧 `local-image`、`resultAssets` 和 `selectedAssetID` 只用于兼容读取，不得由前端重新写入。

### 6.4 素材库与稳定引用

- `--cinema-library-*` 是素材库组件唯一允许直接消费的颜色、surface、边框、阴影和状态语义层；light/dark 只在 token 映射层切换。
- “项目文件”和“素材库”保持两个独立 Rail 入口。素材库、项目文件、Inspector 三者互斥，`Escape` 关闭素材库后焦点回到原 Rail 按钮。
- 素材库使用物理文件夹行和两列素材网格；文件夹永远排在素材前。搜索结果是当前域的扁平结果并显示原路径。
- Canvas 新素材节点只持久化服务端返回的 canonical `assetRef`，不得由前端拼接或保存托管文件的绝对路径。
- 项目和个人素材都以引用方式加入 Canvas。个人引用必须显示“个人素材”和可移植性提示；missing、trashed、processing 状态必须有非颜色文案。
- 图片、视频、音频 Ready 节点默认只有右侧输出 Handle；Video Ready 与 Audio Ready 不显示生成 Composer，原生播放器必须阻止画布拖动手势。

### 5.5 Video Generation Node

标准：

- 预览区必须有稳定 aspect ratio。
- loading overlay 使用轻量半透明 surface，不遮挡节点基本结构。
- 生成按钮使用 primary icon button token，禁用态保留尺寸。
- provider/model/duration/resolution 控件高度统一为 32px。
- 视频生成 Composer 的底部配置固定为单行，顺序为模型、视频规格摘要、时长、高级入口和生成操作。视频规格摘要显示当前宽高比与质量/分辨率，并复用图片生成器的 portal/fixed 二级规格面板进行编辑。
- 状态 chip 不应抢主视觉，running/succeeded/failed 使用 status token。

后续迁移：

- 原生 `select` 可以短期保留。若要与主 Anybox 体验对齐，迁移为统一 combobox/listbox。
- 视频节点 submit button 当前使用浅色填充，应迁移到 `--cinema-button-primary-*`。

### 5.6 File Browser

标准：

- 文件面板是 overlay，不是页面 section。
- 面板宽度保持紧凑，默认右侧浮出，窄屏时占左侧可用空间。
- 文件 row 使用 `grid-template-columns: icon minmax(0, 1fr) meta`。
- 文件名、路径、时间、大小都必须 ellipsis。
- 文件预览只显示真实媒体或文件空状态，不加装饰图。

状态：

- loading 使用 spinner。
- error 使用 `role="alert"` 和 danger token。
- selected row 使用 active surface，不改变 row 高度。

### 5.7 Canvas Navigation

标准：

- 垂直导航使用 icon-only button。
- 每个 button 必须有 `title`、`aria-label`，toggle button 需要 `aria-pressed`。
- active 状态使用 active button token，不使用 text token 反转填充。
- 后续新增剪辑入口时，使用 `Scissors` 图标，视觉应与文件入口一致。

### 5.8 Context Menu 和 Popover

标准：

- 菜单默认使用 `role="menu"` / `role="menuitem"`。
- 菜单行高度 32px 左右，左 icon 固定 15-16px。
- hover、focus-visible、disabled 都必须有状态。
- disabled 菜单项保留尺寸，不能触发 hover active 视觉。
- 文本输入、textarea、contenteditable 区域不接管右键菜单。

当前待补：

- `cinema-context-menu button` 需要增加 `:focus-visible` 样式。
- 菜单 surface、border、shadow 应迁移到 overlay token。

## 6. 控件标准

### 6.1 按钮类型

| 类型 | 使用场景 | 视觉 |
| --- | --- | --- |
| Primary icon button | 生成、提交、继续等当前局部主动作 | 固定正方形或圆形，消费 primary button token |
| Secondary icon button | 返回、刷新、关闭、文件面板入口 | 固定正方形，透明或弱 surface |
| Toolbar button | 文本工具、画布工具 | 高度 24-30px，hover/focus 不改变尺寸 |
| Danger button | 删除节点、删除素材、清空等危险动作 | 默认弱 danger，hover/focus 增强 |
| Segmented/tab button | 视频生成模式、未来 timeline 模式切换 | 使用 tab/segmented 语义，不当普通按钮 |
| Menu item | 右键菜单、模型菜单 | 行式按钮，左 icon，文字 ellipsis |

状态矩阵：

- default：来自对应 button token。
- hover：只改背景、边框、文字或 icon 颜色。
- focus-visible：使用组件自身背景/边框表达，不使用 outline 或 inset ring。
- active/pressed：仅 toggle、tab、menu trigger、selected item 使用。
- disabled：保留尺寸，降低 opacity，hover 不进入可交互视觉。
- loading：保留尺寸，用 spinner 替换 icon 或补充稳定 loading 状态。

### 6.2 输入、Textarea、Select

标准：

- 高度紧凑，默认 30-32px。
- 输入背景、边框、文字、placeholder 全部使用 token。
- focus 只改 border/focus surface，不出现 layout shift。
- textarea 不强制隐藏原生编辑能力。
- 长 prompt 或错误文本必须支持换行，不和按钮重叠。

### 6.3 Progress

标准：

- progress track 高度 4-6px。
- active/indeterminate/succeeded/failed/canceled 使用 status token。
- 百分比和状态文字可选，但不能挤压主控件。
- `prefers-reduced-motion` 下关闭 indeterminate 动画。

### 6.4 Tabs 和 Segmented Controls

标准：

- 用于互斥模式，不用于普通动作。
- 使用真实 `<button>`。
- 页面级或内容分区切换使用 `role="tablist"`、`role="tab"`、`aria-selected`。
- active 不改变尺寸，不使用强阴影。
- tab 文案必须短，长文案 ellipsis。

## 7. 文本和语言

Cinema Web 使用全局 i18n Context 管理 `zh-CN` 与 `en-US`：

- 左上角 Settings 是界面语言的唯一切换入口，语言选择即时生效并写入 `cinema-locale` 本地偏好。
- 用户没有保存偏好时，根据 `navigator.language` 选择中文或英文；非中文系统默认英文。
- 切换语言时必须同步更新 `document.documentElement.lang`。
- 设置、工作区导航、Canvas 核心节点与生成器、项目文件、Timeline 主要编辑控件和 Deliver 渲染设置使用统一翻译资源。
- 新增用户可见文案必须同时补充中文和英文资源，不得在组件内新增仅支持单一语言的硬编码文案。

其他规则：

- 错误信息保留后端原文时，可以显示英文。
- `aria-label` 和 `title` 应与可见文案同语言。
- 按钮文案短，避免句子式按钮。
- helper text 只在影响决策时出现。

## 8. 响应式标准

当前 breakpoint：

- `@media (max-width: 840px)`：收紧垂直导航，文件面板改为左侧占用，隐藏文件预览。
- `@container (min-height: 510px)`：视频节点在高度足够时增大预览和 composer。

后续标准：

- Canvas 本身不做移动端页面化改造，只保证窄窗口可操作。
- 浮层在窄窗口时必须避免被右侧导航挤出。
- 图片节点的上传和 composer 控制区随节点保持固定锚定关系；画布平移或缩放时只更新附着位置，不执行视口边界校正。
- 节点内部使用 container query 优先于全局 media query。
- 时间线界面必须允许横向滚动，不把 clip 压缩到不可编辑。
- 按钮、row、tab、thumbnail 不因 viewport 改变而发生 hover/focus 尺寸跳动。

## 9. 可访问性标准

必须保留：

- 操作使用真实 `<button>`。
- icon-only button 必须有 `aria-label` 或 `title`。
- loading/error/progress 有明确语义。
- danger 行为不能只靠颜色或位置表达。

新增要求：

- 所有自定义 menu item 增加 `:focus-visible` 状态。
- 自定义 listbox/menu 后续补键盘方向键、Enter、Escape 行为。
- 打开浮层时，触发器使用 `aria-expanded`，可关联时使用 `aria-controls`。
- active/toggled 使用 `aria-pressed` 或对应 tab/listbox 语义。
- 图片候选缩略图使用 `radiogroup` / `radio` 语义，并支持 Tab、方向键、Enter 和 Space；图片节点本身可聚焦，`Enter` / `Space` 打开 Empty 创建 UI，`Escape` 关闭。
- 禁用控件使用真实 `disabled`，不要只靠 class。

## 10. Timeline UI 预留标准

后续剪辑台应继承当前 Cinema Web 工具气质：

- 三栏工具布局：素材区、预览和时间线、检查器。
- 顶部是紧凑 topbar，不做 hero。
- 时间线是主工作区，轨道和 clip 使用稳定高度。
- clip 使用小面积色条、缩略图、标题和状态，不做大卡片。
- 右侧 inspector 使用 dense form row，不做装饰卡片。
- 播放、分割、吸附、缩放等工具优先 icon-only，提供 tooltip/label。
- 导出是局部 primary action，同一 action row 只保留一个 primary。

## 11. 迁移优先级

### P0：写新 UI 时立即遵守

- 不新增硬编码颜色。
- 不新增无 `aria-label` 的 icon-only button。
- 不新增 hover/focus 会改变尺寸的控件。
- 不新增卡片套卡片。
- 不新增没有 `min-width: 0` 的可截断 flex/grid 文本区域。
- Canvas 节点类型固定为 `text`、`image`、`video`、`audio`；不新增兼容别名或占位节点。

### P1：下一轮样式整理

- 补齐 button、overlay、status、preview、focus token。
- 把 submit button 从 `var(--cinema-text)` 迁移到 primary button token。
- 把 running/succeeded/failed 颜色迁移到 status token。
- 给 context menu 和 ReactFlow controls 增加 focus-visible 样式。
- 把文件面板、右键菜单、文本模型菜单统一到 overlay token。

### P2：主题和结构整理

- 为 `--cinema-*` token 建立 light/dark 成对映射。
- 将 `NODE_META.accent` 迁移为 CSS token 或命名 accent palette。
- 评估是否将 `styles.css` 拆分为 `tokens.css`、`base.css`、`nodes.css`、`overlays.css`、`responsive.css`。
- 原生 `select` 迁移为统一 picker。

## 12. PR 检查清单

提交 UI 改动前检查：

- 是否新增了 hex、固定灰色、固定白色、固定黑色或 `rgba(...)`。
- light/dark 兼容是否至少在 token 结构上可迁移。
- hover、focus-visible、active、selected、disabled、loading、error 状态是否完整。
- icon-only button 是否有可访问名称。
- 长中文、长英文、路径、模型名是否 ellipsis 或可换行。
- `min-width: 0`、`min-height: 0` 是否覆盖滚动和截断容器。
- 窄窗口下浮层是否仍可操作。
- 图片 Empty、Generating、Choosing、Ready、Preview error 五类表现是否遵守一次填充和最终资产锁定规则。
- 图片候选在确认前是否不会被下游消费，Ready 后是否不再暴露上传或生成入口。
- 动效是否遵守 `prefers-reduced-motion`。
- 是否引入了不必要的卡片、阴影、渐变或大面积强调色。
