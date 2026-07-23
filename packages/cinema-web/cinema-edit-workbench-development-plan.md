# Cinema Edit Workbench Development Plan

> Status: approved for implementation planning  
> Updated: 2026-07-10  
> Scope: Cinema Web `Edit` 工作台；不包含 `Deliver` 的最终渲染与导出实现  
> Related design: [cinema-timeline-editor-design.md](./cinema-timeline-editor-design.md)

## 1. 执行摘要

Cinema Web 已经具备 Create / Edit / Deliver 顶层壳层；Create 与本计划定义的 Edit MVP 已可用，Deliver 已形成开发态闭环但尚未公开启用。本节保留 Edit 的既定边界：它不是第一版复制完整的 DaVinci Resolve，也不是把 Create 节点画布改造成横向时间线，而是一个稳定的“素材装配与粗剪工作台”：

1. 从项目素材库和 Create 生成结果中选择素材。
2. 把视频和音频装配成有顺序、有入出点的 Timeline。
3. 完成选择、移动、裁剪、分割、删除、吸附、播放和保存恢复。
4. 将已经可交付的 Timeline 在保存队列 flush 后交给 Deliver 工作台。

Edit 首次公开启用必须满足完整粗剪闭环。只有静态界面、空 Timeline 或不可持久化的拖拽 Demo 时，Edit tab 继续显示 `Soon` 并保持 disabled。

单人开发的粗略估算为 26–38 个有效开发日，不包含 Deliver、FFmpeg 最终渲染、复杂多轨合成、调色、转场和关键帧系统。估算用于排序，不是发布日期承诺。

## 2. 计划启动时的基础（历史记录）

### 2.1 计划启动时已完成

- Create / Edit / Deliver 顶层 ARIA tab 壳层。
- Create 工作台 Canvas、节点生成与项目素材库。
- 稳定 `CinemaAssetRef` / `CinemaAssetLocator`，素材身份不依赖物理路径。
- Canvas `revision + baseRevision`、串行 Command Queue、写锁和幂等命令。
- 保存状态、失败保留、自动/手动重试和离页保护。
- 多节点生成 pending/error 隔离。
- 临时真实项目的 Playwright 故障注入环境。

### 2.2 计划启动时尚未实现（E0–E5 后均已完成）

- Shared Timeline Schema。
- Timeline 文件与事件存储。
- Timeline API、命令执行和写锁。
- Edit 工作台内部 UI。
- Timeline 播放控制器。
- Clip 拖拽、裁剪、分割、吸附和撤销/重做。
- 音频波形、代理预览和派生缓存。
- Deliver 与 render job。

### 2.3 本计划与长期设计文档的关系

`cinema-timeline-editor-design.md` 保留为长期能力设计。本计划是 Edit MVP 的实施顺序和发布门槛。两者冲突时，Edit MVP 以本计划为准，主要差异如下：

- Export / render job 属于 Deliver，不放入 Edit MVP。
- `selection`、`playhead`、面板宽度和滚动位置属于本机 UI 状态，不进入共享 Timeline 文档。
- Timeline 时间使用整数微秒，不使用浮点秒。
- Timeline 文档强制包含 `revision`；命令强制包含 `id + baseRevision`。
- 不自动把“最新视频”写入新 Timeline，避免用户在无确认时改变工程。
- 第一版不常驻空 Inspector，不预铺大量空轨道。

## 3. 从竞品借鉴什么

竞品截图采用成熟的四区剪辑布局：左侧工具/素材区、中上预览、右侧 Inspector、中下 Timeline。该骨架符合剪辑用户的既有认知，可以借鉴；信息密度和工具数量需要为 Cinema Web 收敛。

| 竞品模式 | Cinema Edit 决策 | 原因 |
| --- | --- | --- |
| 左侧活动栏混合素材、生成历史、调色、文字 | 左侧只保留 Timelines、Project、Outputs、Assets | 生成与创作工具属于 Create，避免职责混杂 |
| Inspector 永久占据大块宽度 | 无选中项时折叠；选中 Clip 后展开 300–340px | 提高预览和 Timeline 的有效面积 |
| Timeline 预铺多条空轨 | 默认只创建 V1、A1；有叠加素材时再创建 O1 | 减少空白和轨道控制噪声 |
| 大量 icon-only 工具 | MVP 只提供 Select、Split、Snap、Undo、Redo、Zoom | 保持核心路径可学习 |
| 多 Timeline 顶部 tabs | Timeline 列表放左侧；MVP 同时只打开一个 | 避免浏览器式 tab 管理复杂度 |
| Edit 顶部直接 Export | Edit 只显示保存状态；未来通过 Deliver tab 交付 | 保持三工作台职责清晰 |
| 小尺寸轨道按钮和弱对比标签 | 控件至少 28px，并提供 tooltip、ARIA label 和键盘路径 | 降低学习与可访问性风险 |

## 4. Create / Edit / Deliver 职责边界

### Create

- 创意编排、Prompt、文本、图片和视频生成。
- 维护生成上下文和节点关系。
- 将生成结果登记为稳定项目素材。
- 不承载逐帧和时间段编辑。

### Edit

- 选择已存在的项目素材。
- 创建和管理 Timeline。
- 装配、移动、裁剪、分割和播放 Clip。
- 管理基础画面适配、音量和轨道状态。
- 判断 Timeline 是否具备交付条件。
- 不创建最终编码任务。

### Deliver

- Timeline 预检。
- 分辨率、帧率、编码、码率和输出范围设置。
- 创建、取消和重试 render job。
- 展示进度、错误和最终输出资产。
- 第一轮 Edit 开发期间继续 disabled。

## 5. 核心用户流程

### 5.1 第一次进入 Edit

1. 用户点击已经启用的 Edit tab。
2. 前端读取 Timeline 列表。
3. 没有 Timeline 时显示空状态，不自动添加素材。
4. 用户点击“新建 Timeline”。
5. 使用项目默认设置创建 Timeline，显示 V1 和 A1 两条空轨。
6. 左侧素材区提示拖入第一个视频，或双击在播放头添加。

### 5.2 创建粗剪

1. 用户在 Outputs 或 Project 中筛选视频。
2. 拖动视频到 V1，或双击添加到播放头。
3. 后续素材默认吸附到前一个 Clip 的结尾。
4. 用户移动、裁剪、分割和删除 Clip。
5. 每次结构修改先本地反馈，再由串行命令获得 Agent ACK。
6. 刷新页面后恢复相同 Timeline 内容。

### 5.3 添加和调整音频

1. 用户把音频或带音轨视频的音频部分添加到 A1。
2. Inspector 提供音量、静音和淡入淡出基础参数。
3. Timeline 显示 Agent 派生的波形；波形未完成时显示稳定占位，不阻塞编辑。

### 5.4 返回 Create

1. 切换前先 flush Edit 未提交命令。
2. 保存 Timeline UI 快照：播放头、缩放、滚动、当前选择和面板尺寸。
3. 卸载重型 Edit DOM，保留 React Query 文档缓存和 Edit UI store。
4. 恢复 Create 的 Canvas 视口与选择，不重新初始化项目。
5. Create 中的生成任务继续运行。

### 5.5 准备交付

1. Edit 运行本地预检：空 Timeline、素材缺失、轨道越界、无主视频等。
2. 通过后显示“可交付”状态。
3. 正常项目在 Deliver 公开发布门槛完成前仍只显示交付状态，不提供伪导出入口。
4. 开发态 Deliver 启用时，切换工作台并传递 `timelineID`；切换前必须完成保存队列 flush。

## 6. Edit 信息架构

### 6.1 大屏布局

```text
CinemaWorkbenchHeader: Create | Edit | Deliver
└─ EditWorkbench
   ├─ EditTopbar: Timeline title | save status
   ├─ EditBody
   │  ├─ MediaBin: timelines / project / generated / imported
   │  ├─ Main
   │  │  ├─ PreviewStage + PlaybackControls
   │  │  └─ TimelineToolbar + Ruler + TrackArea
   │  └─ Inspector: selected clip / track / timeline
   └─ overlays: context menu / picker / error details
```

建议初始尺寸：

| 区域 | 初始尺寸 | 行为 |
| --- | --- | --- |
| 全局工作台顶栏 | 46px | 沿用现有壳层 |
| Edit 内部顶栏 | 38px | Timeline 名称和保存状态 |
| 素材区 | 260px | 可调整，范围 220–360px |
| Inspector | 320px | 默认折叠；选中后展开，范围 280–420px |
| Preview / Timeline | 42% / 58% | 通过水平 splitter 调整 |
| Track header | 112px | 固定在 Timeline 左侧 |

### 6.2 左侧素材区

一级分区：

- `Timelines`
- `Project`
- `Outputs`
- `Assets`

共同能力：

- 搜索。
- 媒体类型筛选。
- List / compact thumbnail 两种密度。
- 单击预览素材；双击添加到播放头。
- 拖放到 Timeline。
- 显示 missing、processing、ready 和 personal dependency 状态。

明确不做：

- 在 Edit 内重新实现 Create 的文字生成、图片生成、调色和 Prompt 面板。
- 在 Edit 内直接删除项目素材；删除统一由素材库执行引用检查和 10 秒撤销。
- 第一版提供复杂素材文件夹管理；高级操作跳转或打开现有素材库。

### 6.3 Preview

MVP 控件：

- 当前时间码 / 总时长。
- 回到开头。
- 上一帧、播放/暂停、下一帧。
- Mute preview。
- Fit preview。
- 分辨率与帧率只读信息。

空状态优先展示“向 Timeline 添加第一个素材”，不展示大面积装饰插画。

### 6.4 Timeline

MVP 工具：

- Select。
- Split at playhead。
- Snap。
- Undo / Redo。
- Zoom out / in / fit。
- Delete 使用键盘和上下文菜单，不常驻危险按钮。

默认轨道：

- `V1` 主视频。
- `A1` 主音频。
- 添加图片、文字或第二视频层时再创建 `O1` 叠加轨。

第一版不开放任意添加无限轨道；内部模型支持多轨，但 UI 先控制范围。

### 6.5 Inspector

- 无选择时折叠，不占据固定宽度。
- 选中视频 Clip：位置、入点、出点、时长、适配、音量。
- 选中音频 Clip：位置、入点、出点、时长、音量、淡入淡出。
- 选中 Track：锁定、静音、隐藏、名称。
- Inspector 数值编辑需要支持 Enter 提交、Escape 取消和输入校验。

### 6.6 响应式

| 宽度 | 布局 |
| --- | --- |
| `>= 1280px` | 素材区 + Preview/Timeline + 按需 Inspector |
| `900–1279px` | Inspector 使用右侧 overlay/drawer |
| `760–899px` | 素材区和 Inspector 都使用 drawer，Preview/Timeline 保持主区域 |
| `< 760px` | Edit 显示桌面窗口过窄提示；不压缩成不可编辑的移动版 |

Timeline 始终横向滚动，不通过缩小 Clip 字体或控制尺寸来强行适配。

## 7. 状态边界

### 7.1 服务端真相

- Timeline 设置。
- Tracks。
- Clips。
- Markers。
- Revision 和更新时间。

### 7.2 本机 UI 状态

- 当前选择。
- 播放头。
- Timeline scroll / zoom。
- 素材区和 Inspector 展开状态。
- splitter 尺寸。
- 当前工具和 snap 开关。

这些字段存入按 `projectID + timelineID` 隔离的本地 UI store，不写入 Timeline command event，也不触发项目保存状态。

### 7.3 派生状态

- Timeline 总时长，从 Clip 末端最大值计算。
- 是否可交付，从 Timeline 校验结果计算。
- 当前活动视频和音频，从播放头与 Clip 范围计算。
- missing / stale asset，从 Asset Catalog 实时解析。

## 8. Shared Contract

建议新增 `packages/shared/src/cinema-timeline.ts`，并从 Shared 公共入口导出。

### 8.1 时间表示

业务数据使用整数微秒，避免浮点误差并支持音视频不同时间基：

```ts
export type CinemaTimelineTime = number // integer microseconds, >= 0

export type CinemaTimelineFrameRate = {
  numerator: number
  denominator: number
}
```

V1 支持：24、25、30、50、60 fps；Schema 保留 `24000/1001` 和 `30000/1001` 等有理数能力，但 UI 可后续开放。

### 8.2 Timeline 文档

```ts
export type CinemaTimelineDocument = {
  schemaVersion: 1
  id: string
  projectID: string
  title: string
  revision: number
  createdAt: string
  updatedAt: string
  settings: {
    width: number
    height: number
    frameRate: CinemaTimelineFrameRate
    sampleRate: 48000
    backgroundColor: string
  }
  tracks: CinemaTimelineTrack[]
  clips: CinemaTimelineClip[]
  markers: CinemaTimelineMarker[]
}
```

不持久化：`selection`、`playhead`、`viewport`、`renderState`、`duration`。

### 8.3 Track

```ts
export type CinemaTimelineTrack = {
  id: string
  kind: "video" | "audio" | "overlay"
  title: string
  order: number
  locked: boolean
  muted: boolean
  hidden: boolean
}
```

### 8.4 Clip

```ts
export type CinemaTimelineClipBase = {
  id: string
  trackID: string
  title: string
  timelineStartUs: CinemaTimelineTime
  durationUs: CinemaTimelineTime
  playbackRate: number
  volume: number
  opacity: number
  fit?: "contain" | "cover"
  createdAt: string
  updatedAt: string
}

export type CinemaTimelineClip = CinemaTimelineClipBase & (
  | {
      kind: "video" | "audio" | "image"
      assetRef: CinemaAssetRef
      sourceInUs: CinemaTimelineTime
      sourceDurationUs: CinemaTimelineTime
    }
  | {
      kind: "text"
      text: {
        value: string
        stylePresetID: string
      }
    }
)
```

约束：

- 非 text Clip 必须包含 `assetRef` 和 source range；text Clip 不包含物理素材引用。
- `durationUs > 0`。
- `sourceInUs + sourceDurationUs` 不得超出已知素材时长；素材 metadata 不可用时允许保存但标记待校验。
- Track kind 与 Clip kind 必须兼容。
- 同轨重叠策略 V1 为禁止；overlay 轨除外但同一 overlay 轨仍不重叠。

### 8.5 命令外壳

```ts
export type CinemaTimelineCommand = {
  id: string
  timelineID: string
  baseRevision: number
  actor: string
} & CinemaTimelineCommandPayload
```

结构命令：

- `create-track`
- `update-track`
- `add-clip`
- `move-clip`
- `trim-clip`
- `split-clip`
- `delete-clips`
- `update-clip`
- `add-marker`
- `move-marker`
- `delete-marker`
- `update-settings`

禁止用一个无限制的 `patch-document` 绕过命令校验。

## 9. 持久化和 Agent API

### 9.1 文件结构

```text
.anybox-cinema/
  timelines/
    timeline_<id>.json
  timeline-events/
    timeline_<id>.jsonl
  cache/
    timelines/
      timeline_<id>/
        thumbnails/
        waveforms/
```

- Timeline JSON 是当前真相。
- JSONL 记录命令事件、actor、revision 和时间。
- 缩略图和波形是可删除派生缓存，不进入 Git 真相源。
- 媒体文件继续由现有 Asset Catalog 管理，不新增 Timeline 私有副本。

### 9.2 API

```text
GET    /api/cinema/projects/:projectID/timelines
POST   /api/cinema/projects/:projectID/timelines
GET    /api/cinema/projects/:projectID/timelines/:timelineID
POST   /api/cinema/projects/:projectID/timelines/:timelineID/commands
GET    /api/cinema/projects/:projectID/timelines/:timelineID/events
DELETE /api/cinema/projects/:projectID/timelines/:timelineID
```

MVP 不提供全量 `PATCH timeline`。创建 Timeline 和 Command 都使用 Zod Schema 校验。

### 9.3 一致性

- 写锁 key：`cinema-timeline:${cinemaRoot}:${timelineID}`。
- 每次成功结构写入递增 revision。
- 过期 `baseRevision` 返回 409 和 latest revision。
- 重复 command ID 返回既有结果，不重复执行。
- 前端使用独立 `CinemaTimelineCommandQueue` 串行发送。
- ACK 前命令不得出队；409 拉取最新 Timeline 后以原 ID 重放。
- 写入使用临时文件 + rename，避免半写 JSON。

### 9.4 Capability

在 `CinemaProjectSummary.capabilities` 增加：

```ts
timelineEditing: boolean
timelineDelivery: boolean
```

- Timeline API、核心编辑闭环和 E2E 未达门槛前，`timelineEditing: false`。
- Edit tab 根据 capability 决定 disabled，不依赖前端临时常量。
- Deliver 完成前始终 `timelineDelivery: false`。

## 10. 前端模块

```text
src/features/timeline/
  api/
    timelineApi.ts
  model/
    timelineTypes.ts
    timelineProjection.ts
    timelineValidation.ts
    timelineSnap.ts
    timelineUndo.ts
    timelineTime.ts
  state/
    timelineUiStore.ts
    TimelineCommandQueue.ts
  playback/
    TimelinePlaybackController.ts
    timelineActiveClips.ts
  components/
    EditWorkbench.tsx
    EditTopbar.tsx
    TimelineMediaBin.tsx
    TimelineList.tsx
    TimelinePreviewStage.tsx
    TimelinePlaybackControls.tsx
    TimelineToolbar.tsx
    TimelineRuler.tsx
    TimelineTrackArea.tsx
    TimelineTrackHeader.tsx
    TimelineClip.tsx
    TimelineInspector.tsx
    TimelineEmptyState.tsx
  hooks/
    useTimelineDocument.ts
    useTimelineCommands.ts
    useTimelinePlayback.ts
    useTimelineDrag.ts
    useTimelineKeyboard.ts
```

约束：

- 不把 Timeline 实现继续塞进 `App.tsx`。
- `App.tsx` 只负责工作台切换、project/runtime 数据和跨工作台 flush。
- Timeline projection、snap 和 active clip 计算保持纯函数，可单元测试。
- Clip 拖动时只更新本地 projection；pointer up 后生成一个 command。
- Track Area 只渲染可视时间范围的 Clip，并保留 overscan。

## 11. 播放方案

### 11.1 MVP

- 暂停态 seek 使用 HTMLVideoElement 和素材 preview URL。
- 播放态使用两个 video 元素交替预加载相邻 Clip，降低切换黑帧。
- 单一活动视频轨负责主画面。
- A1 音频可跟随视频音轨或独立 audio 元素。
- image/text overlay 使用 DOM layer。
- `requestAnimationFrame` 更新本地播放头，不产生服务端命令。

### 11.2 明确限制

- 浏览器预览不是最终渲染真相。
- MVP 不保证复杂多视频叠加无缝播放。
- 不在 Edit 中进行最终编码。
- 预览与最终输出的差异应由未来 Deliver 预检明确提示。

## 12. 开发阶段

### Phase E0：契约与工程骨架（2–3 日）

交付：

- `cinema-timeline.ts` Zod Schema 和类型。
- Timeline API client 接口和 Agent route 占位。
- Timeline 文件路径、安全读取和原子写工具。
- Project capability 字段，默认 false。
- Shared Schema 测试。

验收门槛：

- 非法微秒、track/clip 不兼容、缺失 assetRef 和非法 revision 被拒绝。
- 旧 Cinema 项目仍可打开。
- Edit tab 仍 disabled。

### Phase E1：Timeline CRUD 与可靠命令（4–6 日）

交付：

- list/create/get/delete Timeline。
- `revision + baseRevision` 命令执行器。
- 写锁、事件日志、幂等命令和 409 冲突。
- 前端 Timeline Command Queue。
- 保存状态、失败保留、重试和离页保护。

验收门槛：

- 两个命令并发不会覆盖。
- 响应丢失后重试不重复添加 Clip。
- Agent 重启后 Timeline 可恢复。
- Edit tab 仍只通过开发开关进入。

### Phase E2：静态四区工作台与素材读取（3–5 日）

交付：

- EditTopbar、MediaBin、Preview、Timeline、Inspector shell。
- 亮色/暗色和 splitter。
- Timeline 列表、新建和空状态。
- Project / Outputs / Assets 读取与筛选。
- Inspector 默认折叠。
- 760px 最小宽度保护。

验收门槛：

- 不复制竞品的空 Inspector 和多空轨问题。
- 亮暗主题通过 Axe 和对比度检查。
- 窄窗口无横向页面溢出；Timeline 自身可横向滚动。

### Phase E3：核心粗剪闭环（7–10 日）

交付：

- 添加视频/音频到播放头或 drop time。
- Clip 选择、移动、裁剪、分割和删除。
- Ruler、playhead、zoom、fit 和 snap。
- V1/A1 Track Header。
- Undo / Redo。
- Inspector 基础数值编辑。
- reload 保存恢复。

验收门槛：

- 用户能从空项目完成至少三段视频的粗剪。
- 拖动过程中无网络写入；pointer up 只产生一个命令。
- 保存失败时 Clip 保持本地位置并可重试。
- 切换 Create/Edit 不丢 Canvas 或 Timeline 草稿。

### Phase E4：预览、音频与素材修复（6–8 日）

交付：

- 播放/暂停、seek、上一帧、下一帧。
- 双 video 预加载。
- A1 音频同步和音量。
- Agent 波形缓存。
- image overlay 基础预览。
- missing/personal/deleted asset 状态和替换素材流程；内部 `trashed` 只作为删除撤销期的降级状态。
- Timeline 校验与“可交付”状态。

验收门槛：

- 连续视频 Clip 可顺序播放。
- seek 到 Clip 边界不会选择错误素材。
- 素材移动/改名不破坏 Clip。
- 素材缺失不会删除 Clip，并提供修复路径。

### Phase E5：发布加固并启用 Edit（4–6 日）

交付：

- 键盘完整路径。
- Timeline 可视区域虚拟化。
- Playwright 真实项目 E2E。
- 故障注入、性能和可访问性测试。
- 文档与迁移说明。
- `timelineEditing: true`。

验收门槛：

- 本计划第 13、14 节所有 P0 用例通过。
- Edit tab 对正常项目启用。
- Deliver 继续 disabled。

## 13. 测试计划

### 13.1 Shared

- 所有 Schema 正反例。
- 时间整数、范围和 frame rate 校验。
- Track/Clip 兼容矩阵。
- Command 必须有 `id + timelineID + baseRevision`。

### 13.2 Agent

- CRUD 和原子写。
- revision 冲突。
- command ID 幂等。
- 同 Timeline 写锁。
- 不同 Timeline 可并行。
- 路径穿越、非法 projectID/timelineID。
- 缺失、已删除（内部 `trashed` 降级）和 personal asset 引用。
- 事件日志不泄漏绝对路径或密钥。

### 13.3 前端单元与组件

- time ↔ pixel 转换。
- snap 候选和阈值。
- move/trim/split projection。
- active clips 计算。
- undo inverse command。
- Command Queue 串行、409 换基、失败恢复。
- Clip 键盘选择和 Inspector 表单。
- 空、加载、错误、缺失素材状态。

### 13.4 Playwright 主路径

1. 新建 Timeline。
2. 从项目素材库添加三个视频。
3. 移动、裁剪、分割和删除。
4. 刷新后恢复相同结构。
5. 播放跨过 Clip 边界。
6. 切到 Create 再返回 Edit，状态恢复。
7. 命令断网失败后本地位置保留并可重试。
8. 外部 revision 更新触发原 ID 换基重放。
9. 素材异常缺失或出现内部 `trashed` 降级状态后，Clip 保留并进入不可用修复状态；正常删除会因 Timeline 引用而被阻止。
10. 亮色、暗色、1280px、900px 和 760px 布局。

## 14. 可访问性与键盘门槛

### 全局快捷键

| 按键 | 行为 |
| --- | --- |
| Space | 播放 / 暂停 |
| Left / Right | 前后移动一帧 |
| Shift + Left / Right | 前后移动一秒 |
| S | 在播放头分割选中 Clip |
| Delete / Backspace | 删除选中 Clip，输入框内不拦截 |
| Ctrl/Cmd + Z | Undo |
| Ctrl/Cmd + Shift + Z | Redo |
| Home | 播放头回到开头 |
| Escape | 取消当前拖拽、关闭菜单或清除选择 |

### 门槛

- Toolbar 和 Track Header 图标按钮不小于 28×28px。
- 所有 icon-only 控件有 `aria-label` 和 tooltip。
- Clip 选中不能只靠颜色，增加边框和可访问状态文本。
- 焦点样式使用 semantic token，不使用隐藏 focus。
- Timeline 的水平滚动、缩放和播放不依赖指针设备。
- 动态保存、冲突和 missing asset 状态通过 live region 或邻近文本传达。
- Axe 自动检查为 0 violation；复杂 Timeline 语义仍需人工键盘和读屏验证。

## 15. 性能目标

目标场景：500 个 Clip、8 条内部 Track、30 分钟 Timeline；公开 V1 UI 仍限制默认轨道数量。

| 指标 | 目标 |
| --- | --- |
| 本地 Timeline 首次读取 | 500 Clip 下小于 1 秒 |
| pointer move projection | p95 小于 16ms |
| pointer up 到本地稳定状态 | 小于 50ms |
| 本地 Agent command ACK | 正常场景 p95 小于 200ms |
| Timeline 滚动 | 不因不可见 Clip DOM 产生明显卡顿 |
| 缩略图/波形 | lazy load、可取消、只请求可视范围 |

实现要求：

- 只渲染可视时间范围和 overscan Clip。
- 拖动时禁止全量深拷贝 500 Clip。
- time-to-pixel 计算不触发 React Query 更新。
- 播放头使用独立轻量层，不让整个 Timeline 每帧重渲染。
- 波形和缩略图使用 Agent 派生缓存。

## 16. 主要风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 在 UI 之前先做完整 NLE 数据模型 | 周期失控 | 先锁定 V1/A1 和核心命令 |
| 复用浮点秒 | 边界漂移、split 误差 | 使用整数微秒 |
| 把 UI 状态写入项目文档 | 高频保存与跨设备冲突 | selection/playhead/viewport 本地化 |
| Edit 与 Deliver 边界模糊 | render 逻辑侵入 Timeline | Edit 只产出可交付 Timeline |
| 常驻 Create 与 Edit 重型 DOM | 内存和视频资源占用 | 切换时 flush + snapshot + 卸载 |
| 浏览器多 Clip 连播黑帧 | 预览体验不稳定 | 双 video 预加载，明确 MVP 限制 |
| 素材 metadata 不完整 | trim 校验不可靠 | 允许待校验状态，Agent 异步补全 |
| 竞品式小按钮和低对比度 | 可发现性和无障碍风险 | 28px 控件、tooltip、语义 token、Axe |
| 单个 Timeline 文件过大 | 写入和冲突成本增加 | 命令日志、原子写；达到阈值后再评估分片 |

## 17. Edit 公开启用清单

以下项目全部满足后才设置 `timelineEditing: true`：

- [x] Timeline Schema、CRUD、revision、写锁和幂等命令完成。
- [x] 新建 Timeline 不会自动修改工程内容。
- [x] 视频/音频添加、移动、裁剪、分割和删除可用。
- [x] 保存失败可见，本地修改保留并可重试。
- [x] 刷新和切换工作台不丢数据。
- [x] 播放、暂停、seek 和跨 Clip 播放可用。
- [x] missing asset 保留 Clip 并有修复路径。
- [x] 亮色、暗色、760px–桌面宽度通过验收。
- [x] 键盘主路径和 Axe 检查通过。
- [x] 500 Clip 性能目标通过。
- [x] Playwright 主路径和故障注入通过。
- [x] Deliver 仍保持 disabled，Edit 内没有伪导出按钮。

## 18. 第一批可直接创建的任务

1. [x] `E0-01`：新增 Shared Timeline 时间、Track、Clip、Document Schema。
2. [x] `E0-02`：新增 Timeline Command Schema 和兼容矩阵校验。
3. [x] `E0-03`：新增 Agent Timeline path、read、atomic write 工具。
4. [x] `E0-04`：新增 Timeline list/create/get routes 和 API 测试。
5. [x] `E1-01`：实现 timeline write lock、revision conflict 和 idempotency。
6. [x] `E1-02`：提取可复用 Command Queue 核心，供 Canvas/Timeline 配置使用；若抽象导致耦合，则保持两个实现共享测试契约。
7. [x] `E2-01`：实现开发开关下的 `EditWorkbench` 四区 shell。
8. [x] `E2-02`：实现 Timeline Empty State 和新建流程。
9. [x] `E2-03`：复用 Asset Library API 实现 Media Bin 只读列表。
10. [x] `E2-04`：建立 Edit 亮暗主题、splitter 和窄窗口基线 E2E。

建议从 `E0-01` 开始，不先画完整 Timeline UI。只有稳定的时间模型、素材引用和命令契约确定后，拖拽和裁剪交互才不会反复返工。

## 19. 实施完成与迁移说明

完成日期：2026-07-10。

- E0–E5 已完成，项目摘要正式返回 `timelineEditing: true`；`timelineDelivery` 和 Deliver 工作台继续保持 disabled。
- Timeline 文档继续使用 `schemaVersion: 1`，新增的音频 `fadeInUs` / `fadeOutUs` 为可选字段，旧 Timeline 无需迁移即可读取。
- 未创建 Timeline 的旧 Cinema 项目不会被自动写入 Timeline 文件；用户首次点击“New Timeline”后才创建 `.anybox-cinema/timelines/timeline_<id>.json`。
- Timeline UI 临时状态仍只保存在浏览器本地；项目真相源只包含 Timeline 文档、事件日志和可删除的波形缓存。
- Edit 工作台采用按需加载，不增加 Create 工作台的常驻重型 DOM 和媒体资源。
- 验收覆盖 Shared Schema、Agent 全套服务器测试、前端单元/组件测试、生产构建、Axe、真实 MP4/WAV 主路径、断网/409 故障注入、素材回收与替换，以及 500 Clip / 30 分钟 Timeline 虚拟化场景。

## 20. Post-E5 P0 体验收口

2026-07-11 的 P0 收口不改变 Timeline Schema 或命令契约：

- 空 Timeline 预览提供唯一主操作 `Browse Project Assets`，并直接打开受控 Media Bin 的 Project Assets section。
- 移除无行为的 Preview Fit 和伪 Select 工具；Timeline Fit 保持可用。
- Inspector 对用户显示十进制秒并支持最多 6 位小数，提交时继续转换为整数微秒。
- Transport 时间码显示到毫秒；内部持久化仍使用整数微秒。
- 新增时间转换与空状态导航测试，继续要求 light/dark、760px 和 Axe 门槛。
