# Cinema Timeline Post-MVP Development Plan

> Status: approved for implementation planning  
> Created: 2026-07-11  
> Scope: Cinema Web `Edit` 工作台的 Timeline 可用性升级  
> Baseline: `cinema-edit-workbench-development-plan.md` 的 E0–E5 与 Post-E5 P0 已完成  
> Related design: [cinema-timeline-editor-design.md](./cinema-timeline-editor-design.md)  
> Previous plan: [cinema-edit-workbench-development-plan.md](./cinema-edit-workbench-development-plan.md)

## 1. 执行摘要

Cinema Edit 已具备 Timeline Schema、Agent CRUD、可靠命令队列、保存恢复、基础移动和裁剪、分割、Undo/Redo、播放、音频波形、素材修复与可视区域虚拟化。下一阶段不继续扩大功能面，也不优先建设转场、滤镜、关键帧或复杂合成，而是把已有能力收敛成一个可以持续完成粗剪任务的 Timeline 编辑区域。

本计划的核心目标是：

> 用户能够把至少 10 段视频、图片和音频加入 Timeline，在不依赖 Inspector 精确输入的情况下，通过鼠标和稳定快捷键完成排序、裁剪、分割、多选、复制、Ripple Delete、播放检查、保存和刷新恢复。

下一阶段的第一优先级是 Pointer Timeline 交互内核。现有 HTML Drag and Drop 只在 Drop 时提交结果，无法提供稳定的抓取偏移、实时位置、吸附线、边缘自动滚动和 Escape 取消。应以统一 Pointer 状态机替换 Clip 内部移动交互；素材库向 Timeline 的跨区域拖入可以暂时保留原生 Drag and Drop，待 Pointer 内核稳定后再决定是否统一。

单人开发粗略估算为 24–36 个有效开发日。估算用于排序，不是发布日期承诺。

## 2. 产品边界

### 2.1 本阶段必须完成

- Timeline 横向滚动完全收敛在 Timeline 自身，不产生页面级横向滚动。
- Clip 移动、Trim 和 Playhead Scrub 都有连续实时反馈。
- 吸附同时作用于 Clip 前缘、后缘、Trim 边缘、Playhead、Marker 和相邻 Clip 边界。
- 拖动接近可视区域边缘时自动滚动。
- 所有连续手势支持 Escape 取消，Pointer Up 只提交一次持久化命令。
- 支持单选、多选、框选和多 Clip 整体移动。
- 支持复制、粘贴、复制副本和 Ripple Delete。
- 支持新增、删除、重命名、重排和调整高度的受控多轨工作流。
- 视频 Clip 有可识别的缩略图胶片表达；音频 Clip 保留波形表达。
- Timeline 缩放以鼠标所在时间为锚点，播放和滚动时可保持 Playhead 可见。
- 鼠标与键盘主路径均可完成粗剪，并通过保存失败、Revision Conflict 和刷新恢复测试。

### 2.2 本阶段明确不做

- 转场库和转场参数编辑。
- 关键帧、曲线编辑器、蒙版和逐帧动画。
- 调色、滤镜、LUT、特效插件和复杂字幕系统。
- 多机位、代理剪辑管理和专业媒体 relink 工作流。
- 浏览器端最终编码。
- 为了视觉展示而重写现有 Timeline 文档格式。
- 无限轨道；UI 继续使用受控轨道数量和明确轨道类型。

以上能力只有在本计划的粗剪可用性门槛完成后才进入后续规划。

## 3. 当前基础与主要缺口

### 3.1 已有基础

- Timeline 持久化时间统一使用整数微秒，帧率使用有理数。
- Shared 已提供 `create-track`、`update-track`、`add-clip`、`move-clip`、`trim-clip`、`split-clip`、`delete-clips`、`update-clip` 和 Marker 命令。
- Agent 已提供 Revision、写锁、幂等命令、原子写入和 Conflict Rebase。
- 前端已有命令队列、Undo/Redo、保存失败保留本地状态和 Retry。
- Timeline 已支持基础 Snap 计算、可视 Clip 虚拟化和音频波形缓存。
- Preview 已支持视频、图片、文本 Overlay、单独音频和下一视频预加载。
- Playwright 已覆盖三段素材粗剪、波形、故障注入、素材修复和 500 Clip 性能场景。

### 3.2 当前阻碍真实使用的问题

1. 视频 Clip 仍缺少胶片缩略图，素材辨识效率有限。
2. 音频波形尚未按 Trim 后的 Source In/Duration 映射可见区间。
3. Scrub 媒体 Seek 合并、连续视频边界预加载和播放漂移校正仍待加强。
4. Insert/Overwrite Placement Mode 及其原子受影响 Clip 集合尚未实现。
5. 30 分钟与 500 Clip 的缩放、滚动、虚拟化和内存门槛尚未完整压测。
6. 保存失败、Revision Conflict 与 Diagnostic Drawer 的闭环仍需补齐。
7. Keyboard、Axe、Light/Dark 和多宽度回归仍需扩展到后续新增功能。
8. Timeline 长期设计与快捷键文档仍需在功能稳定后完成同步。

## 4. 成功标准

### 4.1 核心任务门槛

从空 Timeline 开始，用户应能完成以下流程：

1. 从项目素材和生成结果中加入至少 10 段素材。
2. 将素材拖动到目标时间和兼容轨道，拖动中看到实时位置与吸附反馈。
3. 从 Clip 两侧完成 Trim，且 Trim 能吸附到 Playhead 和相邻 Clip。
4. 使用 Ruler 或 Playhead 连续 Scrub 检查任意时间。
5. 使用 Shift 和框选选中多个 Clip，并整体移动。
6. 复制、粘贴或复制副本。
7. 分割 Clip，并使用 Ripple Delete 删除片段和闭合空隙。
8. 使用键盘播放、逐帧检查、删除、撤销和重做。
9. 切换 Create/Edit、刷新页面后恢复 Timeline 文档和本地视口。
10. 在保存失败后保留本地编辑结果，并通过 Retry 完成保存。

### 4.2 交互质量指标

- Pointer Move 不触发网络请求；Pointer Up 最多提交一个业务命令。
- 拖动和 Trim 期间，已挂载的可视 Clip 不因为 React 全文档提交而持续抖动。
- Snap 阈值以像素定义，在不同缩放级别保持接近一致的鼠标手感。
- 时间换算误差不超过半帧；持久化结果始终为整数微秒。
- Escape 取消后，文档、Undo 栈和 Revision 均不发生变化。
- Timeline 可视区域的 Pointer 反馈目标为 60 fps；性能测试环境中不得出现持续超过 50 ms 的交互主线程任务。
- 500 Clip / 30 分钟 Timeline 继续使用虚拟化，不能因胶片缩略图退化为全量 DOM。

### 4.3 布局与可访问性门槛

- 760、900、1280、1700 px 宽度均不出现页面级横向滚动。
- 素材名称、Timeline 名称、Track 名称和 Clip 名称都能稳定省略，不与图标或状态重叠。
- Timeline 内部横向滚动、Track 垂直滚动和侧栏滚动互不劫持。
- Light/Dark 下 Default、Hover、Focus、Selected、Dragging、Snap、Disabled、Locked 和 Error 状态可辨认。
- 所有工具栏动作使用真实 Button、可见 `focus-visible`、`aria-label` 和 Tooltip/Title。
- 键盘焦点不会在虚拟化或关闭浮层后丢失。

## 5. 产品与交互决策

### 5.1 编辑模式

本阶段默认只有一个 Select 模式。Split 继续作为“在 Playhead 分割选中 Clip”的命令，而不是常驻刀片鼠标模式。避免在交互内核稳定前增加多个容易混淆的 Pointer 工具。

### 5.2 放置模式

分两步提供：

- 第一阶段为 Free Move：允许空隙和重叠，沿用当前模型行为。
- 第二阶段增加 Insert / Overwrite 切换；默认使用 Insert，状态只保存在本机 UI Store。

Insert/Overwrite 不得通过悄悄移动其他 Clip 实现。所有受影响 Clip 必须在一次原子命令和一次 Undo 历史记录中明确表示。

### 5.3 Ripple Delete

- 默认只影响被删除 Clip 所在的未锁定轨道。
- 多轨 Ripple 作为后续显式选项，不作为默认行为。
- 被锁定轨道永远不参与 Ripple。
- 删除产生的 Gap 按所选 Clip 在该轨道上的时间并集计算，不能简单使用 Clip 数量或单一时长。

### 5.4 Selection

- 单击：只选择目标 Clip。
- Shift+单击：切换目标 Clip 是否属于当前选择。
- 点击空白：清空选择并移动 Playhead。
- 空白区域拖动：矩形框选。
- Escape：先取消当前 Pointer 手势；没有手势时清空选择。
- Inspector 在单选时显示完整属性；多选时只显示可安全批量修改的公共属性。

### 5.5 Snap

Snap Candidate 包含：

- Timeline `0`。
- Playhead。
- Marker。
- 未参与本次移动的 Clip 起点和终点。
- 当前可见或同轨目标 Clip 边界。

移动 Clip 时同时比较 Selection Group 的最左边缘和最右边缘。Trim 时只比较正在移动的那个边缘。吸附命中后显示一条不遮挡内容的垂直 Guide，并显示目标时间码。

### 5.6 Timeline 导航

- Ruler Pointer Drag：连续 Scrub。
- `Ctrl/Cmd + Wheel`：以鼠标所在时间为锚点缩放。
- `Shift + Wheel`：水平滚动。
- 普通 Wheel：优先垂直浏览 Track；只有一个 Track 区域时仍不滚动整个页面。
- 播放时默认自动跟随 Playhead；用户主动水平滚动后临时暂停自动跟随，直到 Playhead 再次进入边缘区域或用户重新启用。

## 6. 技术架构

### 6.1 原则

- Timeline 文档仍是服务端事实源；Pointer 交互草稿不是 Timeline 文档 Revision。
- Selection、Playhead、Viewport、Interaction Draft 和工具模式仍属于本机 UI 状态。
- 拖动期间只更新轻量 Draft；Pointer Up 后才生成业务命令。
- 使用现有 `timelineTimeToPixels` / `timelinePixelsToTime` 作为唯一投影入口。
- Snap、碰撞、Ripple 区间和多选边界使用纯函数实现并单元测试。
- 不在 `TimelineTrackArea.tsx` 中继续堆积所有手势逻辑；按职责拆分，但不做一次性大重写。

### 6.2 建议模块

```text
src/features/timeline/
  components/
    TimelineTrackArea.tsx
    TimelineRuler.tsx
    TimelineTrackList.tsx
    TimelineTrackHeader.tsx
    TimelineClipBlock.tsx
    TimelineInteractionOverlay.tsx
    TimelineFilmstrip.tsx
  interaction/
    timelineInteractionTypes.ts
    timelinePointerProjection.ts
    timelineAutoScroll.ts
    useTimelinePointerInteraction.ts
  model/
    timelineSelection.ts
    timelineSnap.ts
    timelineRipple.ts
    timelineTicks.ts
    timelineClipboard.ts
  state/
    timelineUiStore.ts
    TimelineCommandQueue.ts
```

这些文件按阶段逐步提取。第一阶段只提取 Ruler、Clip Block 和 Interaction Overlay 所需边界，不为了目录整齐提前重写稳定代码。

### 6.3 Pointer 状态机

```ts
type TimelinePointerInteraction =
  | { type: "idle" }
  | {
      type: "moving-clips"
      pointerID: number
      originClientX: number
      grabOffsetUs: number
      originalClips: readonly TimelineClipPlacement[]
      draftClips: readonly TimelineClipPlacement[]
      targetTrackID: string
      snapGuideUs: number | null
    }
  | {
      type: "trimming-clip"
      pointerID: number
      edge: "start" | "end"
      originalClip: CinemaTimelineClip
      draft: TimelineTrimDraft
      snapGuideUs: number | null
    }
  | {
      type: "scrubbing-playhead"
      pointerID: number
      originalPlayheadUs: number
      draftPlayheadUs: number
    }
  | {
      type: "marquee-selecting"
      pointerID: number
      origin: TimelinePoint
      current: TimelinePoint
    }
```

状态机必须有 `begin`、`update`、`commit`、`cancel` 四条显式路径。`pointercancel`、组件卸载和 Escape 都进入 `cancel`；不能把浏览器丢失 Pointer 当作成功提交。

### 6.4 Draft Projection

交互草稿不直接修改服务端 Timeline Document。渲染时使用：

```text
server/local optimistic document
            +
active pointer draft placement
            =
visible projected clips
```

Pointer Up 后，把 Draft 转换为一个 Command，交给现有 Command Queue。Command Queue 的 Optimistic Document 成为新的渲染基础，Pointer Draft 随即清空。

### 6.5 UI Snapshot 扩展

`CinemaTimelineUiSnapshot` 增加：

```ts
type CinemaTimelineUiSnapshotV2 = {
  playheadUs: number
  pixelsPerSecond: number
  scrollLeftPx: number
  scrollTopPx: number
  previewPercent: number
  mediaOpen: boolean
  inspectorOpen: boolean
  snapEnabled: boolean
  followPlayhead: boolean
  placementMode: "insert" | "overwrite"
  selectedClipIDs: string[]
  trackHeightsPx: Record<string, number>
  collapsedTrackIDs: string[]
}
```

UI Snapshot 只写 Local Storage，不改变 Timeline Schema。读取旧 Snapshot 时把 `selectedClipID` 迁移为零个或一个 `selectedClipIDs`。

### 6.6 Shared Command 扩展

第一阶段移动和 Trim 继续使用现有命令，不修改 Shared Schema。

进入多选、复制和多轨后，新增最小的原子命令：

```ts
type MoveCinemaTimelineClipsCommand = {
  type: "move-clips"
  placements: Array<{
    clipID: string
    trackID: string
    timelineStartUs: number
  }>
}

type AddCinemaTimelineClipsCommand = {
  type: "add-clips"
  clips: CinemaTimelineClip[]
}

type DeleteCinemaTimelineTrackCommand = {
  type: "delete-track"
  trackID: string
  deleteClips: boolean
}

type ReorderCinemaTimelineTracksCommand = {
  type: "reorder-tracks"
  trackIDs: string[]
}

type RippleDeleteCinemaTimelineClipsCommand = {
  type: "ripple-delete-clips"
  clipIDs: string[]
  scope: "source-tracks"
}
```

约束：

- 所有数组 ID 唯一且非空。
- Agent 在同一写锁和同一 Revision 内验证并应用全部变更。
- `ripple-delete-clips` 的移动结果由 Agent 根据当前文档计算，避免客户端基于过期 Revision 提交错误位移。
- 命令是加法扩展，不修改 Timeline Document `schemaVersion: 1`。
- Undo/Redo 为每个原子命令生成一条 History Entry，不把多选移动拆成多个用户可见 Undo 步骤。

## 7. 开发阶段

### Phase T0：布局止血与基线冻结（2–3 日）

目标：先消除截图中已经可见的结构问题，为 Pointer 工作建立可靠坐标系。

任务：

- `T0-01`：修复素材行长名称越界、图标/状态/文本重叠。
- `T0-02`：消除页面级横向滚动，确认只有 `.cinema-timeline-scroll-region` 承担 Timeline 横向滚动。
- `T0-03`：修正 Ruler 宽度、112 px Track Header Offset 和实际内容宽度的统一计算。
- `T0-04`：补充 760、900、1280、1700 px 的布局 E2E 截图和 overflow 断言。
- `T0-05`：记录当前 Move、Trim、Scrub、Zoom 行为的回归测试基线。

验收门槛：

- 页面根元素 `scrollWidth === clientWidth`。
- 100 字符中英文素材名不与状态或图标重叠。
- Timeline 内部可横向滚动，Track Header 保持 Sticky。
- 不改变 Timeline Schema 或命令行为。

### Phase T1：Pointer 交互内核（6–8 日）

目标：把单 Clip 移动、Trim 和 Scrub 变成连续、可取消、可吸附的编辑手势。

任务：

- `T1-01`：建立 Pointer 状态机、Pointer Capture 和统一 Cancel 路径。
- `T1-02`：实现带 Grab Offset 的 Clip 实时移动 Draft。
- `T1-03`：把现有 Trim DOM 临时样式迁移到统一 Draft Projection。
- `T1-04`：实现 Ruler 和 Playhead 连续 Scrub。
- `T1-05`：扩展 Snap，支持 Move 前后缘和 Trim 边缘。
- `T1-06`：实现 Snap Guide、时间码提示、非法轨道和锁定轨道反馈。
- `T1-07`：实现水平边缘自动滚动，滚动期间保持时间投影稳定。
- `T1-08`：实现 Escape、`pointercancel`、失焦和组件卸载取消。
- `T1-09`：确保一次手势只产生一个命令和一个 Undo Entry。

验收门槛：

- 用户抓住 Clip 中部拖动时，Clip 不跳到以鼠标为左边缘的位置。
- Move 和 Trim 在不同缩放级别具有一致的 8 px 默认 Snap 手感。
- 拖动跨越可视区域边缘时能够持续自动滚动。
- Escape 后文档、Revision、Undo Stack 和保存状态均不变化。
- Pointer Move 网络请求数为 0；Pointer Up 命令请求数为 1。
- 锁定轨道和不兼容轨道不能被提交。

### Phase T2：Selection 与高频粗剪命令（6–8 日）

目标：支持不依赖 Inspector 的连续粗剪工作流。

任务：

- `T2-01`：把单 `selectedClipID` 迁移到有序 `selectedClipIDs`。
- `T2-02`：实现 Shift+Click 增减选择和空白点击清空。
- `T2-03`：实现矩形框选，并与虚拟化 Clip 几何信息兼容。
- `T2-04`：新增 `move-clips` Shared/Agent 原子命令和 Undo Inverse。
- `T2-05`：实现多 Clip 整体移动与组边缘吸附。
- `T2-06`：新增 `add-clips`，实现 Copy、Paste、Duplicate。
- `T2-07`：实现 Clip Context Menu：Split、Duplicate、Delete、Ripple Delete、Show in Assets。
- `T2-08`：新增 `ripple-delete-clips` Shared/Agent 原子命令。
- `T2-09`：实现 J/K/L、I/O、Delete、S、Space、方向键、Undo/Redo 快捷键冲突测试。
- `T2-10`：多选 Inspector 只暴露安全公共字段，不提供歧义修改。

验收门槛：

- 多选移动只产生一次 Revision 和一次 Undo Step。
- Copy/Paste 生成新 Clip ID，并保留相对时间和轨道关系。
- Ripple Delete 不影响锁定轨道，不产生负时间或非法素材范围。
- Context Menu 支持键盘打开、方向键导航、Escape 关闭和焦点回归。
- 输入框、Textarea 和 ContentEditable 不被全局 Timeline 快捷键劫持。

### Phase T3：Viewport 与受控多轨（4–6 日）

目标：让中长 Timeline 可以导航，并提供足够但受控的轨道组织能力。

任务：

- `T3-01`：实现以鼠标所在时间为锚点的 `Ctrl/Cmd + Wheel` 缩放。
- `T3-02`：保存和恢复水平/垂直滚动位置。
- `T3-03`：实现 Playhead 自动跟随与用户滚动后的临时暂停。
- `T3-04`：增加自适应 Ruler Tick，覆盖帧、秒、10 秒和分钟级。
- `T3-05`：新增受控轨道创建入口：Video、Audio、Overlay/Text。
- `T3-06`：实现 Track 重命名、删除、重排和高度调整。
- `T3-07`：新增 `delete-track`、`reorder-tracks` Shared/Agent 命令。
- `T3-08`：轨道高度、折叠和 Header 状态进入 UI/Document 正确边界。

验收门槛：

- 缩放前后，鼠标下方对应的 Timeline 时间保持不变，允许误差不超过 1 px。
- 刷新后恢复 Timeline 缩放、滚动和 Selection。
- Track 删除必须明确处理非空轨道，不允许静默丢弃 Clip。
- 轨道重排后 Preview 和 Deliver 的层级语义保持一致。
- 30 分钟 Timeline 可以快速 Fit、缩放、滚动和定位 Playhead。

### Phase T4：媒体可读性与预览稳定（4–6 日）

目标：让用户能从 Timeline 本身识别素材，并提高 Scrub 和 Clip 边界预览可信度。

任务：

- `T4-01`：实现 `TimelineFilmstrip`，第一版复用单张缓存缩略图形成稳定胶片条。
- `T4-02`：长 Clip 按可视宽度虚拟化缩略图单元，不按完整时长创建全部 DOM。
- `T4-03`：波形按 Source In/Duration 正确映射 Trim 后的可见区间。
- `T4-04`：Clip 显示必要的标题、媒体类型和缺失素材状态，避免双行信息拥挤。
- `T4-05`：优化 Scrub 时媒体 Seek 合并，避免每个 Pointer Move 强制触发昂贵 Seek。
- `T4-06`：加强连续视频边界预加载、Gap 背景和播放漂移校正。
- `T4-07`：图片和文本 Overlay 应用已有 Fit、Opacity 和 Transform 语义。

验收门槛：

- 用户仅看 Timeline 就能区分不同视频素材和音频段落。
- 500 Clip 性能场景仍保持有限 Clip 和缩略图 DOM 数量。
- 快速 Scrub 不产生无界媒体请求或控制台 Promise 错误。
- 视频边界、空隙和缺失素材都有确定预览结果，不保留上一帧造成误判。

### Phase T5：可靠性、性能与发布收口（2–5 日）

目标：将 T0–T4 形成可公开依赖的 Post-MVP 粗剪基线。

任务：

- `T5-01`：扩展 Unit Test，覆盖 Pointer Projection、Snap、Selection、Ripple、Ticks 和 Clipboard。
- `T5-02`：扩展 Agent 测试，覆盖所有新增原子命令、幂等、Revision Conflict 和非法组合。
- `T5-03`：新增完整 10 Clip 粗剪 Playwright 主路径。
- `T5-04`：新增拖动中断、Pointer Cancel、窗口失焦和自动滚动 E2E。
- `T5-05`：新增多选移动、Copy/Paste、Ripple Delete 和 Undo/Redo E2E。
- `T5-06`：扩展 500 Clip 性能测试和内存/DOM 上限断言。
- `T5-07`：完成 Light/Dark、760–1700 px、Axe 和键盘验收。
- `T5-08`：更新 Timeline 长期设计、快捷键帮助和产品内 Tooltip。

验收门槛：

- 第 4 节全部成功标准通过。
- Shared、Agent、Cinema Web Typecheck/Test/Build 全部通过。
- Playwright 主路径、故障注入、布局、性能和 Axe 用例全部通过。
- 不存在页面级横向滚动、Pointer 卡死、丢失保存或不可撤销的多 Clip 操作。

## 8. 测试计划

### 8.1 Model Unit Test

- Client X、Scroll Left、Track Offset 与 Timeline Time 投影。
- Grab Offset 在不同 Zoom 下保持一致。
- Clip Group 左右边界 Snap。
- Trim Start/End 的最小时长、素材范围和 Fade 约束。
- Auto Scroll 速度曲线与边缘阈值。
- Marquee 与 Clip Rect 相交规则。
- Ripple Gap 时间并集与锁定轨道处理。
- Adaptive Ruler Tick 的帧/秒/分钟级输出。
- Clipboard 新 ID、相对时间和兼容轨道映射。

### 8.2 Component Test

- Pointer Begin/Update/Commit/Cancel 状态变化。
- Moving/Trimming/Selected/Snap/Invalid CSS 状态。
- 多选 Inspector 和 Context Menu 键盘路径。
- Zoom Anchor 和 Scroll Restore。
- Filmstrip/波形 Loading、Ready、Missing、Error 状态。

### 8.3 Shared 与 Agent Test

- 新命令 Zod Schema 严格校验。
- 多 Clip ID 唯一、Track 兼容和锁定轨道校验。
- 新命令幂等重放不重复创建或移动。
- Revision Conflict Rebase 仍使用同一 Operation/Command ID。
- Ripple Delete 计算确定且原子。
- Delete Track 对非空轨道必须按 `deleteClips` 显式处理。

### 8.4 Playwright 主路径

新增或扩展：

```text
e2e/edit-timeline-pointer.pw.ts
e2e/edit-timeline-selection.pw.ts
e2e/edit-timeline-ripple.pw.ts
e2e/edit-timeline-tracks.pw.ts
e2e/edit-timeline-navigation.pw.ts
e2e/edit-timeline-layout.pw.ts
e2e/edit-performance.pw.ts
e2e/edit-reliability.pw.ts
```

关键断言：

- Pointer Move 期间命令 API 请求数为 0。
- Pointer Up 后业务命令请求数为 1。
- Escape、Pointer Cancel 后命令 API 请求数为 0。
- Snap Guide 只在命中阈值内显示。
- 多选移动、Ripple、Copy/Paste 各只增加一个 Revision。
- 刷新后 Document 和 UI Snapshot 分别正确恢复。
- 页面根节点没有横向 Overflow。

## 9. 性能策略

- Pointer Move 使用 `requestAnimationFrame` 合并高频事件。
- Draft 只保存参与交互的 Clip Placement，不复制完整 Timeline Document。
- Snap Candidate 在手势 Begin 时建立索引；手势期间不重复扫描全部 Clip。
- Auto Scroll 与 Pointer Projection 使用同一 Animation Frame，不启动多个竞争 Timer。
- 缩略图只为可视 Clip 和可视宽度生成。
- Filmstrip 图片复用浏览器缓存和 Agent Thumbnail URL，不在 React State 中保存 Base64。
- Preview Scrub 对媒体 Seek 做合并和过期请求丢弃。
- 保留当前 Clip 虚拟化，Selection 几何信息通过轻量 Layout Index 获取，而不是挂载所有 Clip。

## 10. 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| Pointer 重构破坏现有可靠保存 | 产生重复命令或错误 Revision | Draft 与 Command Queue 严格分层；T1 继续使用现有单 Clip 命令 |
| 自动滚动改变坐标系 | Clip 在滚动中跳动 | 每帧重新以 Scroll Position 计算投影，不累计像素 Delta |
| 多选操作拆成多个命令 | Undo 和 Conflict 不原子 | 新增 `move-clips` / `add-clips` / Ripple 原子命令 |
| Ripple 语义不明确 | 用户意外移动其他轨道 | 默认只处理来源轨道，锁定轨道不参与，多轨 Ripple 延后 |
| 胶片缩略图拖慢长 Timeline | DOM 和图片请求爆炸 | 可视宽度虚拟化、缓存复用、第一版单缩略图重复 |
| 快捷键影响输入控件 | Inspector 无法正常编辑 | 统一 Editable Target Guard，E2E 覆盖 Input/Textarea/ContentEditable |
| 轨道删除造成素材丢失 | 不可逆工程修改 | 非空轨道必须二次确认并显式 `deleteClips` |
| 页面 Overflow 破坏 Pointer 坐标 | Drop/Snap 偏移 | T0 先冻结布局和滚动容器边界 |

## 11. 推荐提交边界

为便于审查和回滚，建议按以下边界提交，不把全部阶段压成一次大改：

1. Layout containment 与 overflow tests。
2. Pointer interaction types/projection 纯函数。
3. Clip Move Draft 与 Commit。
4. Trim/Scrub/Snap Guide。
5. Auto Scroll 与 Cancel。
6. Selection Store 与 Marquee。
7. Shared/Agent atomic multi-clip commands。
8. Clipboard、Context Menu 与 Ripple。
9. Zoom Anchor、Ruler Tick 与 Track 管理。
10. Filmstrip、Preview 稳定与最终 E2E。

每个提交都必须保持现有粗剪主路径可运行，不能长期保留两套同时生效的 Move/Trim 处理器。

## 12. 第一批可直接创建的任务

- [x] `T0-01` 修复素材行文字重叠和 Sidebar Overflow。
- [x] `T0-02` 消除页面级横向滚动并新增 1700 px 布局断言。
- [x] `T0-03` 统一 Ruler、Track Header 与 Content Width 投影。
- [x] `T1-01` 新增 Pointer Interaction 类型和 Projection 单元测试。
- [x] `T1-02` 实现带 Grab Offset 的单 Clip Move Draft。
- [x] `T1-03` 将 Trim 接入统一 Draft 和 Cancel 路径。
- [x] `T1-04` 实现 Ruler/Playhead 连续 Scrub。
- [x] `T1-05` 扩展前后缘 Snap 和 Snap Guide。
- [x] `T1-06` 实现 Timeline 边缘自动滚动。
- [x] `T1-07` 新增一次手势一次命令的 Playwright 断言。
- [x] `T2-01` 将单 `selectedClipID` 迁移为可持久化的有序 `selectedClipIDs`。
- [x] `T2-02` 实现 Shift+Click 增减选择和空白点击清空。
- [x] `T2-03` 实现基于文档几何索引的矩形框选，并覆盖虚拟化 Clip。
- [x] `T2-04` 新增 `move-clips` Shared/Agent 原子命令和单条 Undo Inverse。
- [x] `T2-05` 实现多 Clip 整体移动、相对轨道映射与选择组边缘吸附。
- [x] `T2-06` 新增 `add-clips`，实现 Copy、Paste 和 Duplicate。
- [x] `T2-07` 实现 Clip Context Menu 及 Split、Duplicate、Delete、Ripple Delete、Show in Assets。
- [x] `T2-08` 新增 `ripple-delete-clips` Shared/Agent 原子命令和单条 Undo/Redo 历史。
- [x] `T2-09` 补齐 J/K/L、I/O、Delete、S、Space、方向键和 Undo/Redo 快捷键保护。
- [x] `T2-10` 实现多选 Inspector 安全公共字段和原子 `update-clips`。
- [x] `T3-01` 实现以鼠标所在时间为锚点的 `Ctrl/Cmd + Wheel` 缩放，锚点误差不超过 1 px。
- [x] `T3-02` 保存和恢复 Timeline 水平、垂直滚动位置。
- [x] `T3-03` 实现播放时 Playhead 自动跟随，并在用户主动水平滚动后临时暂停。
- [x] `T3-04` 实现可视区虚拟化的帧、秒、10 秒和分钟级自适应 Ruler Tick。
- [x] `T3-05` 新增 Video、Audio、Overlay/Text 受控轨道创建菜单。
- [x] `T3-06` 实现 Track 重命名、显式非空删除确认、原子重排和键盘/指针高度调整。
- [x] `T3-07` 新增 `delete-track`、`reorder-tracks` Shared/Agent 原子命令与 Undo/Redo。
- [x] `T3-08` 将轨道高度、折叠放入 UI Snapshot，锁定、静音、隐藏和顺序保留在 Timeline Document。
- [x] `T4-01` 实现复用缓存缩略图的 `TimelineFilmstrip`。
- [x] `T4-02` 胶片条按可视范围和 Overscan 虚拟化单元，500 Clip 场景保持有限 DOM。
- [x] `T4-03` 音频波形按 Source In/Duration 映射 Trim 后区间。
- [x] `T4-04` Clip 使用紧凑单行标题、媒体类型和缺失素材状态。
- [x] `T4-05` Preview Seek 按动画帧合并，并校正播放/暂停容差。
- [x] `T4-06` 实现相邻视频有界预加载、Gap 清帧和缺失素材确定状态。
- [x] `T4-07` 统一 Preview 与 Deliver 的 Fit、Opacity、Transform 和层级语义。
- [x] `T5-01` Unit Test 覆盖 Pointer Projection、Snap、Selection、Ripple、Ticks 和 Clipboard。
- [x] `T5-02` Agent 测试覆盖新增原子命令、幂等、Revision Conflict 和非法组合。
- [x] `T5-03` 新增不依赖 Inspector 的 10 Clip 键盘粗剪 Playwright 主路径。
- [x] `T5-04` E2E 覆盖 Escape、Pointer Cancel、窗口失焦和边缘自动滚动中断。
- [x] `T5-05` E2E 覆盖多选移动、Copy/Paste、Ripple Delete 和 Undo/Redo。
- [x] `T5-06` 500 Clip 性能测试增加 Clip/Filmstrip DOM、总节点和 JS Heap 上限。
- [x] `T5-07` 完成 populated Timeline 的 Light/Dark、760–1700 px、Axe 和键盘验收。
- [x] `T5-08` 同步 Timeline 长期设计、快捷键帮助和产品内 Tooltip。

Phase T0–T5 已全部完成，Cinema Timeline Post-MVP 粗剪基线进入维护状态。

## 13. Post-MVP 完成清单

- [x] 页面级横向滚动和素材行重叠已消除。
- [x] Move、Trim、Scrub 均为连续 Pointer 交互。
- [x] Grab Offset、Snap Guide、Auto Scroll 和 Escape Cancel 可用。
- [x] 单次手势只产生一次 Command、Revision 和 Undo Entry。
- [x] Shift 多选、框选和多 Clip 移动可用。
- [x] Copy、Paste、Duplicate 和 Ripple Delete 可用。
- [x] 受控多轨创建、删除、重排和高度调整可用。
- [x] 鼠标锚点缩放、自适应 Ruler 和 Playhead Follow 可用。
- [x] 视频胶片缩略图和 Trim 后音频波形可用。
- [x] 10 Clip 粗剪主路径无需依赖 Inspector。
- [x] 保存失败、Conflict、刷新恢复和 Pointer Cancel 不丢数据。
- [x] Light/Dark、760–1700 px、Keyboard、Axe 和 500 Clip 性能门槛通过。
- [x] Timeline 长期设计与快捷键文档已同步更新。
