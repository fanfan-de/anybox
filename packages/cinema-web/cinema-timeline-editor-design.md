# Cinema Timeline Editor Design

## 目标

在 CinemaWeb 画布右侧/左侧的垂直工具栏中增加一个剪辑入口。用户点击最下面的剪辑按钮后，从当前节点画布进入一个新的剪辑台界面。剪辑台用于把 Cinema 生成的视频、导入的视频、图片、音频和文本组织成时间线，完成基础剪切、拼接、预览和导出。

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

现有 [App.tsx](/C:/Projects/Anybox/packages/cinema-web/src/App.tsx) 里有 `CanvasPanelNavigation`，目前只控制 `files` 面板。剪辑入口应扩展为垂直工具栏中的 icon-only button，图标使用 `Scissors`，文案通过 `title` / `aria-label` / tooltip 暴露为 `剪辑`。

### 点击行为

点击剪辑按钮后：

1. 如果项目没有 timeline：
   - 创建默认 timeline。
   - 打开剪辑台。
   - 自动从当前画布中可用的最新视频资产创建一个初始 clip；如果没有视频资产，则显示空时间线。
2. 如果项目已有 timeline：
   - 打开最近编辑的 timeline。
   - 如果有多个 timeline，按钮可先打开剪辑台，再在左侧素材/工程区切换。
3. 画布状态不销毁：
   - `workspaceMode` 从 `"canvas"` 切换到 `"timeline"`;
   - ReactFlow 画布保持内存状态，返回画布时不重新加载。
4. URL 可同步：
   - `?projectID=...&mode=timeline&timelineID=...`
   - 便于刷新后恢复剪辑台。

### 前端模式状态

```ts
type CinemaWorkspaceMode = "canvas" | "timeline"

type CinemaNavigationPanel = "files" | "timeline-assets" | "history" | null

type CinemaWorkspaceState = {
  mode: CinemaWorkspaceMode
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

- 顶部：返回画布、timeline 名称、保存状态、导出按钮。
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
  createdAt: string
  updatedAt: string
  settings: CinemaTimelineSettings
  viewport: CinemaTimelineViewport
  tracks: CinemaTimelineTrack[]
  clips: CinemaTimelineClip[]
  markers: CinemaTimelineMarker[]
  selection: CinemaTimelineSelection
  renderState?: CinemaTimelineRenderState
}
```

### Timeline 设置

```ts
export type CinemaTimelineSettings = {
  width: number
  height: number
  fps: 24 | 25 | 30 | 50 | 60
  sampleRate: 44100 | 48000
  durationSeconds: number
  background: {
    type: "color" | "transparent"
    color?: string
  }
  exportDefaults: {
    format: "mp4"
    videoCodec: "h264"
    audioCodec: "aac"
    bitrateMode: "auto" | "target"
    targetVideoBitrateKbps?: number
  }
}
```

### Timeline 视口

```ts
export type CinemaTimelineViewport = {
  scrollXSeconds: number
  scrollYTracks: number
  pixelsPerSecond: number
  playheadSeconds: number
  snapEnabled: boolean
  snapThresholdPixels: number
}
```

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

时间线统一使用秒作为业务单位，避免帧率变化导致持久化数据迁移困难。渲染时再换算为帧。

```ts
export type CinemaTimelineClipBase = {
  id: string
  trackID: string
  kind: "video" | "audio" | "image" | "text"
  title: string
  timelineStartSeconds: number
  durationSeconds: number
  selected?: boolean
  locked?: boolean
  muted?: boolean
  opacity?: number
  tags?: string[]
  createdAt: string
  updatedAt: string
}
```

### 视频 Clip

```ts
export type CinemaTimelineVideoClip = CinemaTimelineClipBase & {
  kind: "video"
  asset: CinemaTimelineAssetRef
  sourceInSeconds: number
  sourceOutSeconds: number
  playbackRate: number
  fit: "contain" | "cover" | "stretch"
  transform: CinemaTimelineTransform
  crop?: CinemaTimelineCrop
  volume: number
  fadeInSeconds?: number
  fadeOutSeconds?: number
}
```

### 音频 Clip

```ts
export type CinemaTimelineAudioClip = CinemaTimelineClipBase & {
  kind: "audio"
  asset: CinemaTimelineAssetRef
  sourceInSeconds: number
  sourceOutSeconds: number
  playbackRate: number
  volume: number
  pan: number
  fadeInSeconds?: number
  fadeOutSeconds?: number
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

```ts
export type CinemaTimelineAssetRef = {
  id: string
  kind: "video" | "audio" | "image"
  path: string
  mimeType: string
  sizeBytes?: number
  width?: number
  height?: number
  durationSeconds?: number
  fps?: number
  hasAudio?: boolean
  thumbnailPath?: string
  waveformPath?: string
  source:
    | { type: "import"; importedAt: string }
    | { type: "generation-task"; taskID: string; nodeID?: string }
    | { type: "canvas-node"; nodeID: string }
    | { type: "export"; timelineID: string; renderJobID: string }
}
```

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
  timeSeconds: number
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

```ts
export type CinemaTimelineRenderState = {
  latestJobID?: string
  latestOutputAsset?: CinemaTimelineAssetRef
  status: "idle" | "queued" | "running" | "succeeded" | "failed" | "canceled"
  progressPercent?: number
  message?: string
  updatedAt?: string
}
```

## Timeline 命令模型

时间线编辑不要每次全量写文件。前端本地即时修改，后台 debounce 保存 patch 或 command。命令可写入 `timeline-events/timeline_xxx.jsonl`，便于撤销、重做和调试。

```ts
export type CinemaTimelineCommand =
  | { type: "create-track"; track: CinemaTimelineTrack }
  | { type: "update-track"; trackID: string; patch: Partial<CinemaTimelineTrack> }
  | { type: "delete-track"; trackID: string }
  | { type: "add-clip"; clip: CinemaTimelineClip }
  | { type: "update-clip"; clipID: string; patch: Partial<CinemaTimelineClip> }
  | { type: "move-clip"; clipID: string; trackID: string; timelineStartSeconds: number }
  | { type: "trim-clip"; clipID: string; edge: "start" | "end"; timeSeconds: number }
  | { type: "split-clip"; clipID: string; atSeconds: number; newClipID: string }
  | { type: "delete-clips"; clipIDs: string[] }
  | { type: "set-playhead"; timeSeconds: number }
  | { type: "set-viewport"; patch: Partial<CinemaTimelineViewport> }
  | { type: "set-selection"; selection: CinemaTimelineSelection }
  | { type: "update-settings"; patch: Partial<CinemaTimelineSettings> }
```

命令策略：

- 拖动、裁剪、缩放时间线时，本地实时更新。
- 停止拖动后 300-600ms 保存。
- 播放头移动只本地保存，不写事件日志，除非用户关闭页面时需要恢复。
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

现有 asset preview 支持视频 range，但导入接口当前偏图片。剪辑模块需要新增视频导入和 metadata 探测：

```text
POST /api/cinema/projects/:projectID/assets/imports/video
POST /api/cinema/projects/:projectID/assets/:assetID/probe
POST /api/cinema/projects/:projectID/assets/:assetID/thumbnails
POST /api/cinema/projects/:projectID/assets/:assetID/waveform
```

### Render API

```text
POST /api/cinema/projects/:projectID/timelines/:timelineID/render-jobs
GET  /api/cinema/projects/:projectID/timelines/:timelineID/render-jobs
GET  /api/cinema/projects/:projectID/render-jobs/:jobID
POST /api/cinema/projects/:projectID/render-jobs/:jobID/cancel
```

Render job body:

```ts
export type CreateCinemaTimelineRenderJobBody = {
  timelineID: string
  title?: string
  range?: {
    startSeconds: number
    endSeconds: number
  }
  settings?: {
    width?: number
    height?: number
    fps?: number
    videoBitrateKbps?: number
    audioBitrateKbps?: number
  }
}
```

Render job:

```ts
export type CinemaTimelineRenderJob = {
  id: string
  timelineID: string
  title: string
  status: "queued" | "running" | "succeeded" | "failed" | "canceled"
  progress: {
    phase: "queued" | "probing" | "rendering" | "finalizing" | "succeeded" | "failed" | "canceled"
    percent?: number
    message?: string
  }
  inputTimelinePath: string
  outputAsset?: CinemaTimelineAssetRef
  ffmpegCommandPreview?: string
  error?: string
  createdAt: string
  updatedAt: string
}
```

## 渲染方案

第一版使用 Agent 后端 FFmpeg：

1. 读取 timeline JSON。
2. 校验所有 assetPath 在项目目录内。
3. 使用 ffprobe 获取源素材 metadata。
4. 生成 FFmpeg input list 和 filter graph。
5. 渲染到 `exports/` 临时文件。
6. 成功后 rename 为最终 MP4。
7. 写入 render job JSON。
8. 更新 timeline renderState。
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

- 播放头落在某个视频 clip 上时，使用 HTMLVideoElement seek 到 `sourceInSeconds + localOffset`。
- 图片和文本 clip 使用 DOM/CSS overlay。
- Transform 使用 CSS transform。
- 多视频轨第一版可以只预览最高可见轨；第二版再用 canvas compositor 叠加。
- 音频第一版跟随主视频，独立音频轨第二版使用 Web Audio。

关键状态：

```ts
type TimelinePlaybackState = {
  status: "paused" | "playing" | "seeking"
  playheadSeconds: number
  startedAtPerformanceMs?: number
  startedAtTimelineSeconds?: number
  activeVideoClipID?: string
  activeAudioClipIDs: string[]
}
```

## 点击功能列表

### 垂直导航

| 控件 | 点击行为 |
| --- | --- |
| 剪辑按钮 | 进入剪辑台。没有 timeline 时创建默认 timeline；已有 timeline 时打开最近 timeline。 |
| 剪辑按钮 hover | 显示 tooltip：`剪辑`。 |
| 剪辑按钮 active | 保持选中态，表示当前处于剪辑台。 |
| 返回画布按钮 | 从剪辑台返回节点画布，保留剪辑台内存状态并触发一次保存。 |

### 顶栏

| 控件 | 点击行为 |
| --- | --- |
| Timeline 名称 | 进入重命名状态，回车保存，Esc 取消。 |
| 保存状态 | 如果保存失败，点击展开错误详情和重试按钮。 |
| 导入 | 打开文件选择器，支持视频、图片、音频。导入后加入素材库，不自动加入时间线。 |
| 导出 | 打开导出弹窗。 |
| 导出弹窗确认 | 创建 render job，关闭弹窗，显示导出进度。 |
| 导出进度 | 点击打开 render job 详情。 |

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
| 适应画布 | 预览 stage zoom 恢复到 fit。 |
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
| clip 左边缘拖动 | 裁剪开头，改变 `sourceInSeconds` 和 `timelineStartSeconds`。 |
| clip 右边缘拖动 | 裁剪结尾，改变 `durationSeconds` 和 `sourceOutSeconds`。 |
| clip 右键 | 打开菜单：分割、复制、删除、静音、在素材库中显示、替换素材。 |
| clip 上方缩略图 | 仅展示，不单独点击。 |
| clip 内标题 | 长标题 ellipsis，hover 显示完整路径或标题。 |

### Inspector

| 控件 | 点击行为 |
| --- | --- |
| 开始时间输入 | 修改 clip `timelineStartSeconds`。 |
| 时长输入 | 修改 clip `durationSeconds`。 |
| 源入点输入 | 修改 `sourceInSeconds`。 |
| 源出点输入 | 修改 `sourceOutSeconds`。 |
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

第一版建议：

| 快捷键 | 行为 |
| --- | --- |
| Space | 播放/暂停 |
| Delete / Backspace | 删除选中 clips |
| Ctrl+Z | 撤销 |
| Ctrl+Shift+Z / Ctrl+Y | 重做 |
| S | 在播放头分割选中 clip |
| M | 添加 marker |
| ArrowLeft | 后退一帧 |
| ArrowRight | 前进一帧 |
| Shift+ArrowLeft | 后退 1 秒 |
| Shift+ArrowRight | 前进 1 秒 |
| Ctrl++ | 放大时间线 |
| Ctrl+- | 缩小时间线 |
| Esc | 清空选择或关闭弹窗 |

## 与现有 Cinema 的关系

### 画布节点

可选新增 `timeline` node type：

```ts
type CinemaTimelineCanvasNodeData = {
  timelineID: string
  title: string
  durationSeconds: number
  thumbnailPath?: string
  latestOutputAssetPath?: string
  renderStatus?: "idle" | "queued" | "running" | "succeeded" | "failed" | "canceled"
}
```

如果第一版不想扩展 node type，也可以不创建 timeline 节点，只把剪辑台作为项目级 workspace。后续再把 timeline 作为节点嵌回画布。

### 资产来源

剪辑台素材来源：

- `generated/videos/*`：视频生成结果。
- `assets/imported/*`：用户导入。
- `exports/*`：已有导出结果。
- canvas 中 video/output 节点的 `outputAssets`。

### 事件

剪辑相关事件写入 timeline event log，同时关键事件追加到 Cinema project events：

- 创建 timeline。
- 导入视频。
- 创建 render job。
- render succeeded/failed/canceled。

## 实现阶段

### Phase 1: 入口和静态剪辑台

- 扩展垂直导航，加入剪辑按钮。
- 增加 `workspaceMode`。
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

- 新增视频导入 API。
- ffprobe 读取 duration/fps/width/height/hasAudio。
- 生成缩略图。
- 生成音频波形缓存。

### Phase 4: 导出

- 新增 render job API。
- FFmpeg 渲染单轨/基础多轨。
- 导出进度展示。
- 导出资产写回 timeline renderState。
- 在素材库中展示导出结果。

### Phase 5: 体验完善

- 多轨叠加预览。
- 文本 clip。
- 图片 overlay。
- 音频轨。
- marker 和 range selection。
- 更完整的属性面板。

## 风险与取舍

- 浏览器预览和 FFmpeg 导出可能不完全一致。第一版应明确支持范围，避免复杂效果。
- 视频导入文件可能很大，需要限制大小和异步导入。
- 时间线拖动会产生大量状态变化，必须做本地即时状态和 debounce 保存。
- `canvas.json` 不应承载 timeline 全量数据，否则画布保存会变慢。
- 复杂多轨预览如果用 DOM video 会受限，后续可能需要 canvas compositor 或 Remotion 方案。

## 推荐第一版验收标准

- 点击剪辑按钮能进入剪辑台。
- 没有 timeline 时自动创建一个 timeline。
- 能导入一个视频并加入时间线。
- 能播放、暂停、拖动播放头。
- 能裁剪头尾、分割、删除、拖动 clip。
- 刷新页面后 timeline 保留。
- 能导出一个 MP4。
- 导出 MP4 能通过现有 Cinema asset preview 播放。
