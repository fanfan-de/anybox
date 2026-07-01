# Right sidebar resizer causes Workbench reflow lag

日期：2026-07-01

## 问题目标

拖拽右侧 sidebar 的 resizer 时，中间 Workbench 必须实时跟随重排，但当前实时重排过程会明显卡顿。这个文档记录已经做过的排查、尝试和已排除方向，避免后续继续从零开始。

非目标：

- 不接受只移动预览线、松开鼠标后再提交宽度。
- 不接受牺牲 Workbench 实时宽度变化来换取表面流畅。
- 不把问题简单归因到 React 重渲染，除非 trace 能证明每次 pointermove 都触发重 React commit。

## 复现方式

1. 启动 Electron + Vite + CDP：

   ```powershell
   corepack pnpm run dev:cdp
   ```

2. 打开 Anybox 主窗口，目标 renderer 通常是：

   ```text
   http://localhost:5175/
   ```

3. 拖拽右侧 resizer：

   ```css
   [role="separator"][aria-label="Resize right sidebar"]
   ```

4. 观察中间 Workbench 在右侧栏宽度实时变化时的卡顿。

## 当前实现入口

相关文件：

- `packages/desktop/src/renderer/src/app/use-desktop-shell.ts`
- `packages/desktop/src/renderer/src/styles/shell.css`
- `packages/desktop/src/renderer/src/styles/sidebar.css`
- `packages/desktop/src/renderer/src/styles/workbench.css`
- `packages/dockview-core/src/dockview/dockviewComponent.ts`
- `packages/dockview-core/src/dockview/dockviewShell.ts`
- `packages/dockview-core/src/splitview/splitview.ts`
- `packages/dockview-core/src/dom.ts`

关键路径：

- `handleRightSidebarResizerPointerDown` 创建 `ActiveSidebarResize`。
- `startSidebarResize` 监听 `window.pointermove`。
- `queueSidebarResizePreview` 通过 `queueRendererLayoutWrite` 合并到 renderer frame。
- `applySidebarResizePreview` 在拖拽过程中实时写入：

  ```ts
  resizeState.appShell.style.setProperty("--right-sidebar-display-width", widthValue)
  resizeState.appShell.style.setProperty("--right-sidebar-width", widthValue)
  ```

- `shell.css` 中 `.app-shell` 的 grid columns 使用了 `--right-sidebar-display-width`：

  ```css
  grid-template-columns:
    var(--left-rail-width)
    var(--sidebar-display-width)
    var(--sidebar-resizer-width)
    minmax(0, 1fr)
    var(--right-sidebar-resizer-width)
    var(--right-sidebar-display-width);
  ```

结论：现有实现已经避免了每次 pointermove 直接 set React state；每帧主要是在写 CSS var，由 CSS grid 驱动 Workbench/Dockview 实时重排。

## Trace 记录

本次使用 Chrome DevTools MCP 连接 Electron CDP 调试。

调试环境：

- OS：Windows
- Electron renderer：`http://localhost:5175/`
- CDP：`127.0.0.1:9222`
- Vite dev server：`5175`

已保存 trace：

- 实时重排基线：`tmp/codex-devtools/right-resizer-drag-trace.json.json.gz`
- 被排除的 transform 预览方案：`tmp/codex-devtools/right-resizer-drag-trace-after.json.json.gz`
- 页面快照：`tmp/codex-devtools/anybox-after-right-resizer-fix.snapshot.txt`

基线 trace 中，拖拽移动阶段的主要数据：

| 指标 | 基线实时重排 |
| --- | ---: |
| pointermove 数量 | 97 |
| move-only 窗口 | 约 2040.9ms |
| `Layout` | 约 67.8ms / 190 次 |
| `UpdateLayoutTree` | 约 52.0ms / 190 次 |
| `Paint` | 约 78.9ms / 1520 次 |
| `Layerize` | 约 56.5ms / 274 次 |
| `EventDispatch` | 约 14.3ms / 97 次 |

观察：

- pointermove handler 本身很短，单次通常低于 1ms。
- React/UserTiming 中没有看到每个 pointermove 都触发大的 React commit。
- 卡顿主要来自 CSS grid 宽度变化导致的 Workbench/Dockview layout、paint、layerize，而不是 pointer event JS handler 自身。

## 已做过的尝试

### 1. 确认现有 resize 已经做了 frame 合并

现有代码不是每个 pointermove 都立即写布局，而是通过：

```ts
queueRendererLayoutWrite(`sidebar-resize:${resizeState.side}`, () => {
  resizeState.previewCancel = null
  applySidebarResizePreview(resizeState, resizeState.latestWidth)
})
```

这说明“加 requestAnimationFrame 合并写入”不是完整解法，因为当前已经有类似机制。问题仍然存在，说明瓶颈在每帧真实布局重排本身，而不是 pointermove 事件过密地直接写 DOM。

### 2. 尝试 transform-only resizer preview，已排除

曾尝试把右侧拖拽改成：

- 拖动过程中不更新 `.app-shell` 的 `--right-sidebar-width`。
- 只用 `transform: translate3d(...)` 移动 resizer 预览线。
- pointerup 时再一次性提交真实宽度。

验证结果：

| 指标 | transform 预览方案 |
| --- | ---: |
| pointermove 数量 | 100 |
| move-only 窗口 | 约 2931.6ms |
| `Layout` | 0ms / 0 次 |
| `Paint` | 0ms / 0 次 |
| `UpdateLayoutTree` | 约 21.6ms / 99 次 |

这个方案性能上有效，但被排除，原因是它不满足产品要求：用户需要 Workbench 在拖拽过程中实时重排，而不是只看到一条预览线移动。

当前状态：该方案的代码改动已撤回，文档仅保留这个尝试记录。

### 3. 类型检查和测试

在 transform 预览方案期间跑过：

```powershell
corepack pnpm --filter anybox-desktop-agent typecheck
corepack pnpm --filter anybox-desktop-agent test -- App.test.tsx
```

两者都通过。这个结果只说明那次尝试没有破坏类型和目标测试，不代表它是可接受方案。

## 已排除或暂不优先的方向

### React state 每帧更新

拖拽过程中当前代码主要写 CSS var，React state 在 commit 阶段才更新：

```ts
setRightSidebarWidth(resizeState.latestWidth)
```

因此“每个 pointermove 都 React setState 导致卡顿”目前证据不足。

### pointermove handler 自身太重

trace 里 `EventDispatch` 总耗时不高，单次 pointermove 通常低于 1ms。主要耗时不在事件处理函数本身。

### 网络请求或接口阻塞

这次交互 trace 没有显示网络请求是拖拽卡顿主因。

### 运行时错误

console 里没有本次问题相关的应用错误。看到的是 Vite/React dev 提示，以及 Chromium 的通用 issue，例如 SharedArrayBuffer / Deprecated feature。

### 非实时提交

transform-only preview 已证明可以消除拖动阶段 layout/paint，但不满足实时重排要求，所以不是正确方向。

## 下一步可验证假设

### 1. 优化 Dockview/Workbench 对容器宽度变化的响应

重点看：

- `packages/dockview-core/src/dockview/dockviewComponent.ts`
- `packages/dockview-core/src/dockview/dockviewShell.ts`
- `packages/dockview-core/src/splitview/splitview.ts`
- `packages/dockview-core/src/dom.ts`

要验证的问题：

- Workbench 宽度变化时，Dockview 是否对所有 pane、所有 split、所有非活跃 tab 都做了同步 layout？
- ResizeObserver 回调是否在每帧内又触发多次读写交错？
- 是否可以只同步 active/visible pane，把非可见 pane 的布局延后？
- 是否可以把 Dockview 内部 resize 也接入 `renderer-frame-coordinator`，保证每帧只有一次读写批次？

### 2. 减少实时重排期间的绘制成本

拖拽期间 body 会加：

```css
body.is-resizing-sidebar
```

可以继续验证：

- resize 期间关闭 Workbench 内部非必要阴影、滤镜、过渡、复杂背景。
- resize 期间降低 right sidebar 或 workbench 内部列表的 paint 范围。
- 用 `contain: layout paint` 给安全边界做隔离，但不能破坏 Dockview 尺寸计算。

注意：这类改动必须用 trace 验证，不能只看主观流畅度。

### 3. 保持实时但降低更新频率

当前已经按 frame 合并，但仍可能每帧都触发布局。可以实验：

- 只在宽度变化超过 2px 或 4px 时更新 CSS var。
- 对 pointermove 的 `latestWidth` 做像素量化。
- 对高刷新率屏幕限制到 60Hz 或 45Hz。

这个方向仍然保持实时重排，但会有轻微离散感，需要产品确认可接受程度。

### 4. 检查 `.app-shell` grid 布局模型

当前右侧宽度变化会重新计算整个 grid track：

```css
minmax(0, 1fr) var(--right-sidebar-resizer-width) var(--right-sidebar-display-width)
```

可验证替代模型：

- 保持视觉实时，但减少 grid track 重新计算范围。
- 尝试将右侧栏从主 grid 中剥离，Workbench 通过 `right` / `inset` 或明确 width 跟随变化。
- 对比 grid var 更新、inline style width 更新、container wrapper width 更新三种方式的 trace。

风险：布局结构改动可能影响标题栏、窗口控制区域、右侧栏 collapse、响应式和 custom HTML background，需要覆盖回归测试。

### 5. 对 Workbench 内部做临时 resize mode

拖拽开始时已经有 `beginRendererInteractiveLayout("sidebar-resize")`。可以沿着这个状态给 Workbench/Dockview 加“resize mode”：

- 暂停非必要 ResizeObserver 副作用。
- 暂停非活跃 pane 的 expensive measurement。
- 暂停非关键装饰层绘制。
- pointerup 后恢复完整布局。

这个方向比 transform preview 更接近目标，因为 Workbench 仍然实时变宽，只是内部非关键工作延后。

## 后续验证标准

一个可接受修复至少要满足：

- 拖拽过程中 `.app-shell` 的 `--right-sidebar-display-width` 或等价布局宽度实时变化。
- Workbench 可见区域实时跟随变宽或变窄。
- trace 中 move-only 阶段的 `Layout`、`Paint`、`Layerize` 明显低于基线。
- pointermove handler 不能引入新的长任务。
- console 没有新增运行时错误。
- 相关测试覆盖右侧拖拽仍是实时布局，而不是延迟提交。

建议每次实验都记录：

```text
实验名称：
改动文件：
是否保持实时重排：
trace 文件：
move-only pointermove 数量：
Layout：
UpdateLayoutTree：
Paint：
Layerize：
主观体感：
结论：
```

## 当前结论

问题不是“没有 debounce/RAF”这么简单。当前实现已经把拖拽写入合并到 frame，并避免了每帧 React state 更新；真正的成本来自右侧宽度实时变化触发 `.app-shell` grid 重新计算，进而让中间 Workbench/Dockview 在拖拽期间持续 layout/paint。

正确方向应该是在保持 Workbench 实时重排的前提下，降低 Dockview/Workbench 对每次容器宽度变化的同步布局和绘制成本。
