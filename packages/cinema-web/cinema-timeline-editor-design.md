# Cinema Timeline Editor Design

> Status: Edit implemented；Deliver V1 frontend implemented behind the release gate。Create / Edit / Deliver 顶层壳层已经实现，Edit 已公开启用；Deliver 已接入真实 Agent preflight/job/output 链路，但 D5 发布门槛完成前对正常项目仍为 disabled，可通过开发开关进入真实工作台进行验收。

> 本文保留为长期能力设计；Edit MVP 的实施顺序、范围收敛和发布门槛以 [cinema-edit-workbench-development-plan.md](./cinema-edit-workbench-development-plan.md) 为准。

## 目标

在 CinemaWeb 顶层 Create / Edit / Deliver 工作台中启用 Edit。用户从 Create 节点创作画布切换到 Edit 剪辑台，把 Cinema 生成的视频、导入的视频、图片、音频和文本组织成时间线，完成基础剪切、拼接和预览；最终渲染与交付入口归入 Deliver。

这个模块不替代现有节点画布。画布继续负责 AI 创作编排，剪辑台负责成片编辑，Agent 后端负责文件探测、缩略图、波形和最终渲染。

## 产品边界

第一版只做可交付剪辑闭环：

- 从项目素材库和生成结果添加视频到时间线。
- 支持单视频轨、单音频轨、图片/文本叠加轨的基础编辑。
- 支持播放、暂停、seek、裁剪头尾、分割、删除、拖动排序、吸附、缩放时间线。
- 支持保存剪辑工程。
- 支持 Agent 后端通过 FFmpeg 导出 MP4。
- 导出结果写入项目 `exports/`，并在 Cinema 项目中作为资产可预览。

第一版不做完整专业剪辑软件能力：

- 不做复杂转场库。
- 不做逐帧曲线动画编辑。
- 不做多机位、调色曲线、关键帧蒙版。
- 不在浏览器内执行完整视频编码。

## 入口设计

### 当前入口

现有 [CinemaWorkbenchShell.tsx](/C:/Projects/Anybox/packages/cinema-web/src/features/workbench/CinemaWorkbenchShell.tsx) 已展示 Create / Edit / Deliver 三个顶层 tab。Create 与 Edit 当前可用；Deliver 由 `timelineDelivery` capability 控制，开发期间可通过 `VITE_CINEMA_DELIVER_DEV=1` 进入真实 preflight/job 工作台。不要向 Canvas 垂直工具栏增加重复的剪辑或交付入口。

### 点击行为

启用并点击 Edit 后：

1. 如果项目没有 timeline：
   - 打开 Edit 空状态。
   - 用户显式点击“新建 Timeline”后创建默认 V1/A1。
   - 不自动添加当前画布的最新视频，避免未经确认修改工程。
2. 如果项目已有 timeline：
   - 打开最近编辑的 timeline。
   - 如果有多个 timeline，按钮可先打开剪辑台，再在左侧素材/工程区切换。
3. Create 画布状态不销毁：
   - `activeWorkspace` 从 `"create"` 切换到 `"edit"`;
   - 切换前保存 ReactFlow 视口、选择和草稿；重型非活动工作台可以卸载。
   - 返回 Create 时从 UI store 和 React Query cache 恢复，不重新初始化项目。
4. URL 可同步：
   - `?projectID=...&workspace=edit&timelineID=...`
   - 便于刷新后恢复剪辑台。

### 前端模式状态

```ts
type CinemaWorkspaceID = "create" | "edit" | "deliver"

type CinemaNavigationPanel = "files" | "timeline-assets" | "history" | null

type CinemaWorkspaceState = {
  activeWorkspace: CinemaWorkspaceID
  activePanel: CinemaNavigationPanel
  activeTimelineID: string | null
  returnToCanvasViewport?: {
    x: number
    y: number
    zoom: number
  }
}
```

## 界面架构

剪辑台采用固定生产工具布局，不做营销式页面。推荐结构：

```text
cinema-shell
  cinema-workbench-header
    Create / Edit / Deliver
  cinema-workbench-panel (Edit)
    cinema-workspace
      cinema-topbar
    cinema-editor
      cinema-editor-sidebar
        media bin
        timeline list
        generated assets
      cinema-editor-main
        preview stage
        playback controls
        timeline toolbar
        track area
      cinema-editor-inspector
        selected clip properties
        timeline settings
        render settings
```

### 主区域

- 全局顶部：Create / Edit / Deliver 工作台切换。
- Edit 内部顶部：timeline 名称、保存状态，以及进入 Deliver 的交付动作。
- 左侧：项目素材、生成结果、导出结果、timeline 列表。
- 中间上方：预览舞台。
- 中间下方：时间轴轨道。
- 右侧：属性检查器。

### 响应式

- 大屏：三栏布局，左素材、中预览+时间线、右属性。
- 窄窗口：右侧属性改为可折叠 drawer；素材区也可收起。
- 时间线区域必须始终可横向滚动，不压缩 clip 到不可编辑状态。

## 模块拆分

建议新增：

```text
src/features/timeline/
  components/
    TimelineEditorShell.tsx
    TimelineTopbar.tsx
    TimelineMediaBin.tsx
    TimelinePreviewStage.tsx
    TimelinePlaybackControls.tsx
    TimelineToolbar.tsx
    TimelineRuler.tsx
    TimelineTrackList.tsx
    TimelineTrackHeader.tsx
    TimelineClipBlock.tsx
    TimelineInspector.tsx
    TimelineExportDialog.tsx
  hooks/
    useTimelineDocument.ts
    useTimelineCommands.ts
    useTimelinePlayback.ts
    useTimelineSelection.ts
    useTimelineDrag.ts
    useTimelineAutosave.ts
  model/
    timeline-types.ts
    timeline-commands.ts
    timeline-layout.ts
    timeline-validation.ts
```

后端建议新增：

```text
packages/anyboxagent/src/server/usecases/cinema-timeline.ts
packages/anyboxagent/src/server/routes/cinema-timeline.ts
packages/shared/src/cinema-timeline.ts
```

## 文件存储

保留现有 `.anybox-cinema/` 结构，新增 timelines 和 renders：

```text
.anybox-cinema/
  canvas.json
  project.json
  events.jsonl
  timelines/
    timeline_xxx.json
  timeline-events/
    timeline_xxx.jsonl
  render-jobs/
    render_xxx.json

assets/
  imported/
    video_xxx.mp4
    image_xxx.png

generated/
  videos/

renders/
  previews/
    timeline_xxx_thumbnail.jpg
    timeline_xxx_proxy.mp4

exports/
  timeline_xxx_2026-07-06_180000.mp4
```

原则：

- `canvas.json` 只保存画布状态，不保存完整剪辑时间线。
- `timeline_xxx.json` 保存剪辑工程。
- `render-jobs` 保存导出任务状态。
- `exports/` 保存最终导出结果。
- `renders/previews/` 保存缩略图、代理文件、波形缓存。

## 核心数据结构

### Timeline 文档

```ts
export type CinemaTimelineDocument = {
  schemaVersion: 1
  id: string
  projectID: string
  title: string
  revision: number
  createdAt: string
  updatedAt: string
  settings: CinemaTimelineSettings
  tracks: CinemaTimelineTrack[]
  clips: CinemaTimelineClip[]
  markers: CinemaTimelineMarker[]
}
```

`selection`、`playhead`、`viewport` 和 render job 状态都是 UI 或 Deliver 域状态，不写入 Timeline 文档。持久化事实来源为 `@anybox/shared/cinema-timeline`。

### Timeline 设置

```ts
export type CinemaTimelineSettings = {
  width: number
  height: number
  frameRate: { numerator: number; denominator: number }
  sampleRate: 48000
  backgroundColor: string
}
```

输出编码设置属于 Deliver 的 `CinemaRenderSettings`，不写入 Timeline settings；Timeline duration 从 Clip 计算，不重复持久化。

### Timeline 视口

```ts
export type CinemaTimelineViewport = {
  scrollLeftPx: number
  scrollYTracks: number
  pixelsPerSecond: number
  playheadUs: number
  snapEnabled: boolean
  snapThresholdPixels: number
}
```

Viewport 只保存在前端 UI store。时间值仍使用整数微秒，像素值只用于视图投影。

### 轨道

```ts
export type CinemaTimelineTrack = {
  id: string
  kind: "video" | "audio" | "overlay" | "text"
  title: string
  index: number
  height: number
  locked: boolean
  muted: boolean
  hidden: boolean
  solo: boolean
  collapsed: boolean
}
```

### Clip 基类

时间线持久化和命令统一使用整数微秒；帧率使用有理数。浮点秒只允许出现在媒体元素边界的临时换算中，不进入 Shared Schema 或 JSON 文档。

```ts
export type CinemaTimelineClipBase = {
  id: string
  trackID: string
  kind: "video" | "audio" | "image" | "text"
  title: string
  timelineStartUs: number
  durationUs: number
  playbackRate: number
  volume: number
  opacity: number
  createdAt: string
  updatedAt: string
}
```

### 视频 Clip

```ts
export type CinemaTimelineVideoClip = CinemaTimelineClipBase & {
  kind: "video"
  asset: CinemaTimelineAssetRef
  sourceInUs: number
  sourceDurationUs: number
  playbackRate: number
  fit: "contain" | "cover" | "stretch"
  transform: CinemaTimelineTransform
  crop?: CinemaTimelineCrop
  volume: number
  fadeInUs?: number
  fadeOutUs?: number
}
```

### 音频 Clip

```ts
export type CinemaTimelineAudioClip = CinemaTimelineClipBase & {
  kind: "audio"
  asset: CinemaTimelineAssetRef
  sourceInUs: number
  sourceDurationUs: number
  playbackRate: number
  volume: number
  pan: number
  fadeInUs?: number
  fadeOutUs?: number
}
```

### 图片 Clip

```ts
export type CinemaTimelineImageClip = CinemaTimelineClipBase & {
  kind: "image"
  asset: CinemaTimelineAssetRef
  fit: "contain" | "cover" | "stretch"
  transform: CinemaTimelineTransform
  crop?: CinemaTimelineCrop
}
```

### 文本 Clip

```ts
export type CinemaTimelineTextClip = CinemaTimelineClipBase & {
  kind: "text"
  text: string
  style: {
    fontFamily: string
    fontSize: number
    fontWeight: number
    color: string
    align: "left" | "center" | "right"
    backgroundColor?: string
  }
  transform: CinemaTimelineTransform
}
```

### Clip Union

```ts
export type CinemaTimelineClip =
  | CinemaTimelineVideoClip
  | CinemaTimelineAudioClip
  | CinemaTimelineImageClip
  | CinemaTimelineTextClip
```

### 资产引用

Timeline 与 Canvas 共用素材库的稳定引用，不能再把物理路径作为身份写入 clip。路径、预览代理和缩略图由 Agent 按 `assetID + contentRevision` 解析；素材移动、改名、回收与恢复不需要改写 timeline。

```ts
export type CinemaTimelineAssetRef = CinemaAssetRef
```

Timeline 加载时批量读取素材详情获得 `fps / hasAudio / sizeBytes` 等易变 metadata。个人素材仍是本机依赖；缺失或位于回收站时，现有 clip 保留并显示修复状态，但不能创建新的 clip。替换素材只能选择相同媒体 kind。

### Transform / Crop

```ts
export type CinemaTimelineTransform = {
  x: number
  y: number
  scale: number
  rotationDegrees: number
  anchorX: number
  anchorY: number
}

export type CinemaTimelineCrop = {
  left: number
  top: number
  right: number
  bottom: number
}
```

### Marker

```ts
export type CinemaTimelineMarker = {
  id: string
  timeUs: number
  title: string
  color: "default" | "warning" | "success" | "danger"
}
```

### Selection

```ts
export type CinemaTimelineSelection = {
  clipIDs: string[]
  trackIDs: string[]
  markerIDs: string[]
}
```

### Render State

Render 状态不属于 Timeline 文档。Deliver 使用独立的 `CinemaRenderJob` 和 append-only job events，并显式保存 `timelineID` 与 `timelineRevision`；Timeline 后续编辑不会改写既有 job 的输入身份。

## Timeline 命令模型

时间线编辑不要每次全量写文件。前端本地即时修改，后台 debounce 保存 patch 或 command。命令可写入 `timeline-events/timeline_xxx.jsonl`，便于撤销、重做和调试。

```ts
export type CinemaTimelineCommand =
  | { type: "create-track"; track: CinemaTimelineTrack }
  | { type: "update-track"; trackID: string; patch: Partial<CinemaTimelineTrack> }
  | { type: "delete-track"; trackID: string }
  | { type: "add-clip"; clip: CinemaTimelineClip }
  | { type: "update-clip"; clipID: string; patch: Partial<CinemaTimelineClip> }
  | { type: "move-clip"; clipID: string; trackID: string; timelineStartUs: number }
  | { type: "trim-clip"; clipID: string; edge: "start" | "end"; timeUs: number }
  | { type: "split-clip"; clipID: string; atUs: number; newClipID: string }
  | { type: "delete-clips"; clipIDs: string[] }
  | { type: "update-settings"; patch: Partial<CinemaTimelineSettings> }
```

命令策略：

- 拖动、裁剪、缩放时间线时，本地实时更新。
- 停止拖动后 300-600ms 保存。
- 播放头、viewport 和 selection 只进入本地 UI snapshot，不写 Timeline 文档或事件日志。
- `add/split/delete/render` 这类结构变化写事件日志。
- 支持 undo/redo 时优先基于 command inverse，而不是全量 snapshot。

## Agent API

### Timeline API

```text
GET    /api/cinema/projects/:projectID/timelines
POST   /api/cinema/projects/:projectID/timelines
GET    /api/cinema/projects/:projectID/timelines/:timelineID
PATCH  /api/cinema/projects/:projectID/timelines/:timelineID
POST   /api/cinema/projects/:projectID/timelines/:timelineID/commands
GET    /api/cinema/projects/:projectID/timelines/:timelineID/events
DELETE /api/cinema/projects/:projectID/timelines/:timelineID
```

### Asset API

剪辑台直接复用 Cinema 素材库契约，不再新增一套 timeline 私有导入与探测接口：

```text
GET  /api/cinema/projects/:projectID/library/entries
POST /api/cinema/projects/:projectID/library/uploads
GET  /api/cinema/projects/:projectID/library/assets/:assetID
GET  /api/cinema/projects/:projectID/library/assets/:assetID/content
GET  /api/cinema/projects/:projectID/library/assets/:assetID/thumbnail
GET  /api/cinema/projects/:projectID/library/assets/:assetID/preview
```

`content` 与 `preview` 支持 Range。音频波形不属于素材库 v1；Timeline 后续需要时，以 timeline 派生缓存实现，不能写回素材身份。

### Render API

```text
POST /api/cinema/projects/:projectID/timelines/:timelineID/render-jobs
GET  /api/cinema/projects/:projectID/timelines/:timelineID/render-jobs
GET  /api/cinema/projects/:projectID/render-jobs/:jobID
POST /api/cinema/projects/:projectID/render-jobs/:jobID/cancel
```

Render job body:

```ts
export type CreateCinemaRenderJobBody = {
  operationID: string
  expectedTimelineRevision: number
  settings: CinemaRenderSettings
}
```

Render job:

```ts
export type CinemaRenderJob = {
  schemaVersion: 1
  id: string
  projectID: string
  timelineID: string
  timelineRevision: number
  operationID: string
  status: CinemaRenderJobStatus
  settings: CinemaRenderSettings
  progress: CinemaRenderJobProgress
  outputAssetRef?: CinemaAssetRef
  error?: CinemaRenderJobError
  createdAt: string
  updatedAt: string
}
```

完整严格契约以 `@anybox/shared/cinema-render` 为准。Job/API 不返回绝对输入路径、输出路径或完整 FFmpeg 命令。

## 渲染方案

第一版使用 Agent 后端 FFmpeg：

1. 读取 timeline JSON。
2. 校验所有 assetPath 在项目目录内。
3. 使用 ffprobe 获取源素材 metadata。
4. 生成 FFmpeg input list 和 filter graph。
5. 渲染到 `exports/` 临时文件。
6. 成功后 rename 为最终 MP4。
7. 写入 render job JSON。
8. 将输出登记为 `source: "render"` 的项目资产，并把稳定 `CinemaAssetRef` 写入 job。
9. 追加 Cinema event。

基础映射：

- 裁剪视频：`trim=start:end,setpts=PTS-STARTPTS`
- 裁剪音频：`atrim=start:end,asetpts=PTS-STARTPTS`
- 拼接：`concat`
- 图片时长：`loop` 或 `-loop 1 -t duration`
- 缩放：`scale`
- 画面适配：`pad/crop/scale`
- 叠加：`overlay`
- 音量：`volume`
- 淡入淡出：`fade` / `afade`

## 前端预览方案

第一版预览不做浏览器实时合成编码。预览只需要交互准确、反馈快：

- 播放头落在某个视频 clip 上时，把 `sourceInUs + localOffsetUs` 临时换算为 HTMLVideoElement 所需的秒值。
- 图片和文本 clip 使用 DOM/CSS overlay。
- Transform 使用 CSS transform。
- 多视频轨第一版可以只预览最高可见轨；第二版再用 canvas compositor 叠加。
- 音频第一版跟随主视频，独立音频轨第二版使用 Web Audio。

关键状态：

```ts
type TimelinePlaybackState = {
  status: "paused" | "playing" | "seeking"
  playheadUs: number
  startedAtPerformanceMs?: number
  startedAtTimelineUs?: number
  activeVideoClipID?: string
  activeAudioClipIDs: string[]
}
```

## 点击功能列表

### 全局工作台导航

| 控件 | 点击行为 |
| --- | --- |
| Edit tab | 启用后进入剪辑台。没有 timeline 时显示新建空状态；已有 timeline 时打开最近 timeline。 |
| Create tab | 返回节点创作画布，保留 Edit 内存状态并先触发一次 timeline 保存。 |
| Deliver tab | Timeline 和 render job 契约完成前保持 disabled；之后进入检查、渲染与交付工作台。 |

### 顶栏

| 控件 | 点击行为 |
| --- | --- |
| Timeline 名称 | 进入重命名状态，回车保存，Esc 取消。 |
| 保存状态 | 如果保存失败，点击展开错误详情和重试按钮。 |
| 导入 | 打开文件选择器，支持视频、图片、音频。导入后加入素材库，不自动加入时间线。 |
| 送往 Deliver | Deliver 实现前不显示；实现后切换工作台并传递当前 `timelineID`。 |

### 素材区

| 控件 | 点击行为 |
| --- | --- |
| 素材行单击 | 选中素材并在右侧/底部显示 metadata。 |
| 素材行双击 | 将素材添加到当前播放头所在位置。 |
| 素材行拖拽到时间线 | 在落点 track 和时间创建 clip。 |
| 素材行右键 | 打开菜单：添加到时间线、重命名、在项目中显示、删除导入资产。 |
| 生成结果筛选 | 切换显示全部、视频、图片、音频、导出。 |
| 搜索框输入 | 过滤素材列表。 |

### 预览区

| 控件 | 点击行为 |
| --- | --- |
| 播放/暂停 | 切换播放状态。 |
| 上一帧 | 按 timeline fps 将播放头后退一帧。 |
| 下一帧 | 按 timeline fps 将播放头前进一帧。 |
| 回到开头 | 播放头跳到 0。 |
| 适应画布 | 当前不展示；Preview zoom 尚未实现前不提供无行为控件。 |
| 预览画面单击 | 如果画面上有可选 clip overlay，选中最上层 clip。 |
| 预览画面拖动 | 修改选中 clip 的 transform x/y。 |
| 预览缩放控件 | 调整 preview stage zoom，不影响导出尺寸。 |

### 时间线工具栏

| 控件 | 点击行为 |
| --- | --- |
| 选择工具 | 设置鼠标为选择/移动 clip 模式。 |
| 分割工具 | 点击 clip 时在播放头位置分割。 |
| 删除 | 删除选中 clips。 |
| 吸附 | 开关 snap，吸附到播放头、clip 边界、marker。 |
| 添加标记 | 在播放头位置创建 marker。 |
| 撤销 | 执行上一条 command inverse。 |
| 重做 | 恢复下一条 command。 |
| 时间线缩小 | 降低 `pixelsPerSecond`。 |
| 时间线放大 | 提高 `pixelsPerSecond`。 |
| 适应全部 | 调整 viewport 让全部 clips 可见。 |

### 时间尺

| 控件 | 点击行为 |
| --- | --- |
| 时间尺单击 | 播放头跳到点击时间。 |
| 时间尺拖动 | 拖拽 scrub 播放头。 |
| marker 单击 | 选中 marker。 |
| marker 双击 | 重命名 marker。 |
| marker 拖动 | 移动 marker 时间。 |

### Track Header

| 控件 | 点击行为 |
| --- | --- |
| 轨道名称 | 重命名轨道。 |
| 锁定 | 切换 track locked，锁定后 clips 不可移动/裁剪/删除。 |
| 静音 | 切换 track muted，影响预览和导出。 |
| 隐藏 | 切换 track hidden，影响预览和导出画面。 |
| 折叠 | 切换 track collapsed，改变轨道高度。 |
| 添加轨道 | 新增对应类型轨道。 |
| 轨道右键 | 打开菜单：重命名、复制轨道、删除轨道、清空轨道。 |

### Clip

| 控件 | 点击行为 |
| --- | --- |
| clip 单击 | 选中 clip，右侧 inspector 显示属性。 |
| clip 双击 | 打开源素材预览/精修裁剪弹窗。 |
| clip 拖动 | 移动到新时间或新轨道。 |
| clip 左边缘拖动 | 裁剪开头，改变 `sourceInUs` 和 `timelineStartUs`。 |
| clip 右边缘拖动 | 裁剪结尾，改变 `durationUs` 和 `sourceDurationUs`。 |
| clip 右键 | 打开菜单：分割、复制、删除、静音、在素材库中显示、替换素材。 |
| clip 上方缩略图 | 仅展示，不单独点击。 |
| clip 内标题 | 长标题 ellipsis，hover 显示完整路径或标题。 |

### Inspector

| 控件 | 点击行为 |
| --- | --- |
| 开始时间输入 | 修改 clip `timelineStartUs`。 |
| 时长输入 | 修改 clip `durationUs`。 |
| 源入点输入 | 修改 `sourceInUs`。 |
| 源时长输入 | 修改 `sourceDurationUs`。 |
| 音量 slider | 修改 clip volume。 |
| 透明度 slider | 修改 clip opacity。 |
| 位置 X/Y 输入 | 修改 transform x/y。 |
| 缩放输入 | 修改 transform scale。 |
| 旋转输入 | 修改 transform rotationDegrees。 |
| 适配 segmented control | 切换 contain/cover/stretch。 |
| 删除 clip | 删除选中 clip，使用 danger 行为。 |

### 导出弹窗

| 控件 | 点击行为 |
| --- | --- |
| 分辨率选择 | 修改导出 width/height。 |
| FPS 选择 | 修改导出 fps。 |
| 码率模式 | auto/target 互斥切换。 |
| 仅导出选区 | 如果有 range selection，只渲染该范围。 |
| 开始导出 | 创建 render job。 |
| 取消 | 关闭弹窗，不改 timeline。 |

## 右键菜单

时间线区域需要接管右键菜单。文本输入、数字输入和 textarea 保留原生右键菜单。

Clip 菜单：

- 分割
- 复制
- 删除
- 静音/取消静音
- 锁定/解锁
- 替换素材
- 在素材库中显示

Track 菜单：

- 重命名
- 添加上方轨道
- 添加下方轨道
- 清空轨道
- 删除轨道

素材菜单：

- 添加到播放头
- 添加到时间线末尾
- 在项目中显示
- 重新生成缩略图
- 删除导入素材

## 键盘快捷键

当前实现：

| 快捷键 | 行为 |
| --- | --- |
| Space | 播放/暂停 |
| Delete / Backspace | 删除选中 clips |
| Ctrl/Cmd+C | 复制选中 clips |
| Ctrl/Cmd+V | 在播放头粘贴并保持相对时间/轨道关系 |
| Ctrl/Cmd+D | Duplicate 选中 clips |
| Ctrl/Cmd+Z | 撤销 |
| Ctrl/Cmd+Shift+Z | 重做 |
| S | 在播放头分割选中 clip |
| I | 将选中 clip 的 Source In 裁到播放头 |
| O | 将选中 clip 的 Source Out 裁到播放头 |
| J / K / L | 反向播放 / 暂停 / 正向播放 |
| Home | 播放头回到起点 |
| ArrowLeft | 后退一帧 |
| ArrowRight | 前进一帧 |
| Shift+ArrowLeft | 后退 1 秒 |
| Shift+ArrowRight | 前进 1 秒 |
| Esc | 先取消 Pointer 手势；无手势时清空选择或关闭浮层 |

输入框、Textarea 和 ContentEditable 获得焦点时，上述 Timeline 快捷键不接管输入。工具栏和 Transport 的原生 `title` Tooltip 会显示已实现的对应快捷键；Context Menu 同时显示 Split、Duplicate 和 Delete 快捷键。

## Post-MVP 粗剪实现基线（2026-07）

当前 Edit 工作区已经从最初单 Clip MVP 收敛为可持续粗剪的 Post-MVP 基线：

- Move、Trim、Playhead Scrub 共用 Pointer `begin / update / commit / cancel` 状态机；保留 Grab Offset，支持 Snap Guide、边缘自动滚动以及 Escape、`pointercancel`、窗口失焦和卸载取消。一次手势只提交一个原子命令。
- Selection 使用有序 `selectedClipIDs`，支持 Shift 增减、跨虚拟化 Clip 的 Marquee、多 Clip 原子移动、Copy/Paste、Duplicate、Ripple Delete 与单步 Undo/Redo。
- Viewport 以鼠标时间为锚点缩放，使用可视区 Clip、Ruler Tick 和 Filmstrip Cell 虚拟化。UI Snapshot 持久化播放头、缩放、水平/垂直滚动、多选、面板开关、轨道高度/折叠和 Playhead Follow。
- Track 支持受控创建 Video、Audio、Overlay，支持重命名、锁定、静音、隐藏、原子重排、显式非空删除和 72–240 px 高度调整。Preview 与 Deliver 共用轨道顺序语义。
- 视频 Clip 复用素材库缓存缩略图形成胶片条；音频波形是 Timeline 派生缓存，并按 `sourceInUs / sourceDurationUs` 映射 Trim 后区间。Ready、Missing、Trashed 和 Error 都有稳定占位状态。
- Preview 对 Seek 做每帧合并，最多预加载相邻两个视频；Gap 和缺失素材会清除上一帧。视频、图片和文本使用与 Deliver 一致的 `fit / opacity / transform / anchor` 语义。
- 可靠性基线包括 Command ID 幂等、Revision Conflict Rebase、离线队列、刷新恢复、素材修复以及 Agent 原子投影验证。500 Clip / 30 分钟场景保持有限 Clip、Tick 和 Filmstrip DOM。
- 发布验收覆盖 10 Clip 键盘粗剪主路径、Light/Dark、760–1700 px、Axe、键盘冲突保护和 500 Clip 首屏性能。

## 与现有 Cinema 的关系

### 画布节点

可选新增 `timeline` node type：

```ts
type CinemaTimelineCanvasNodeData = {
  timelineID: string
  title: string
  durationSeconds: number
  thumbnailPath?: string
  latestOutputAsset?: CinemaAssetRef
  renderStatus?: "idle" | "queued" | "running" | "succeeded" | "failed" | "canceled"
}
```

如果第一版不想扩展 node type，也可以不创建 timeline 节点，只把剪辑台作为项目级 workspace。后续再把 timeline 作为节点嵌回画布。

### 资产来源

剪辑台素材来源：

- 项目素材库中的上传、生成、裁剪、渲染和迁移素材。
- 个人素材库中的本机直接引用。
- Canvas 中已经使用 `assetRef` 的 image/video/audio 节点；最终输出由 Deliver 工作区管理，不再建模为 Canvas 节点。
- Timeline render 成功后登记到项目素材库的输出素材。

旧目录 `generated/*`、`assets/imported/*`、`exports/*` 和旧节点 `outputAssets` 只由素材库迁移器读取；新 Timeline 文档一律只写 `assetRef`。

### 事件

剪辑相关事件写入 timeline event log，同时关键事件追加到 Cinema project events：

- 创建 timeline。
- 导入视频。
- 创建 render job。
- render succeeded/failed/canceled。

## 实现阶段

### Phase 1: 入口和静态剪辑台

- 已完成 Create / Edit / Deliver 顶层工作台壳层，Create 与 Edit 已开放。
- Edit tab 已由服务端 `timelineEditing` capability 启用。
- 新建剪辑台 shell。
- 加载/创建 timeline document。
- 显示素材列表、预览区、空时间线。

### Phase 2: Timeline 编辑 MVP

- 添加 track/clip 数据结构。
- 支持素材添加到时间线。
- 支持播放头、时间尺、拖动、裁剪、分割、删除。
- 支持 autosave。
- 支持基本 undo/redo。

### Phase 3: 资产导入和 metadata

- 接入项目 / 个人素材库选择器与 `assetRef`。
- 复用素材库上传、ffprobe metadata、缩略图、预览代理和 Range 播放。
- 对 missing / trashed / personal dependency 提供修复状态。
- 音频波形作为 Timeline 独立派生缓存后续实现。

### Phase 4: 导出

- 新增 render job API。
- FFmpeg 渲染单轨/基础多轨。
- 导出进度展示。
- 导出资产登记到 Asset Library，并把 `CinemaAssetRef` 写入独立 render job。
- 在素材库中展示导出结果。

### Phase 5: 体验完善

- 多轨叠加预览。
- 文本 clip。
- 图片 overlay。
- 音频轨。
- marker 和 range selection。
- 更完整的属性面板。
- 已完成 P0 空 Timeline 引导、受控 Project Assets 跳转、毫秒时间显示和十进制秒 Inspector；多选、多轨管理与 Preview zoom 仍属后续能力。

## 风险与取舍

- 浏览器预览和 FFmpeg 导出可能不完全一致。第一版应明确支持范围，避免复杂效果。
- 视频导入文件可能很大，需要限制大小和异步导入。
- 时间线拖动会产生大量状态变化，必须做本地即时状态和 debounce 保存。
- `canvas.json` 不应承载 timeline 全量数据，否则画布保存会变慢。
- 复杂多轨预览如果用 DOM video 会受限，后续可能需要 canvas compositor 或 Remotion 方案。

## 推荐第一版验收标准

- 启用后的 Edit tab 能进入剪辑台，Create tab 能无重载返回节点画布。
- 没有 timeline 时显示明确空状态，并可显式创建一个 timeline。
- 能导入一个视频并加入时间线。
- 能播放、暂停、拖动播放头。
- 能裁剪头尾、分割、删除、拖动 clip。
- 刷新页面后 timeline 保留。
- 能导出一个 MP4。
- 导出 MP4 能通过现有 Cinema asset preview 播放。
# Subtitle Track / Cue MVP (Schema V2)

Cinema Timeline Schema V2 adds a dedicated `subtitle` Track and Cue type. Subtitle Cues remain in the document `clips` array so selection, move, split, clipboard, delete, Ripple, optimistic projection, revision history, Undo and Redo use the same atomic command path as other timed content. V1 documents are migrated in memory and are only persisted as V2 after the first successful edit.

The editor exposes S1/S2 tracks, a subtitle Media Bin page, a compact 3-second Cue composer, separate Cue and track-style inspectors, SRT/WebVTT import/export, one active preview language, and non-blocking readability/timing warnings. Subtitle tracks allow overlaps; all media-track overlap rules remain unchanged.

The fixed `anybox-subtitle-sans-v1` family maps to Noto Sans CJK SC Regular 2.004. Preview style values are authored against 1920×1080 and scaled by the actual canvas height, matching ASS delivery conversion.
