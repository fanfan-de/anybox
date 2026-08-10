# Cinema Deliver 工作台开发计划

> Status: in progress（D0–D4 completed；D5 application-level hardening completed；双平台候选构建与 fail-closed capability 已实现，生产产物和审批仍 blocked）
> Date: 2026-07-10  
> Scope: Cinema Web `Deliver` 工作台、Shared Render 契约、Agent 本地渲染任务与输出资产闭环  
> Depends on: [Cinema Edit 工作台开发计划](./cinema-edit-workbench-development-plan.md) E0–E5 已完成

## 1. 结论：下一步先完成 Deliver V1

Edit 已经能稳定产出 Timeline，下一步最有价值的工作不是立即扩展转场、调色、关键帧或无限多轨，而是完成 Deliver：

1. 对指定 Timeline revision 做服务端预检。
2. 冻结一次可复现的渲染输入快照。
3. 由 Agent 创建、排队、取消、恢复和重试 FFmpeg render job。
4. 把成功输出登记为 `source: "render"` 的项目资产。
5. 在 Deliver 工作台展示设置、进度、错误、历史和最终输出。

只有这条链路完成后，Create → Edit → Deliver 才是完整产品闭环。高级 Edit 能力应在 Deliver V1 之后按真实输出需求排序。

建议立即从 Phase D0、D1 开始：先锁定 Render Schema、快照语义和预检支持矩阵，不先制作导出弹窗或模拟进度。

## 2. 当前基线

### 2.1 已可复用能力

- Create / Edit / Deliver 顶层 ARIA tab 壳层。
- `timelineEditing: true`，`timelineDelivery: false`。
- Timeline 使用整数微秒、rational frame rate 和稳定 `CinemaAssetRef`。
- Timeline CRUD、revision、写锁、幂等 command、事件日志和原子写。
- V1/A1/O1、视频/音频/图片/文本 Clip Schema。
- Clip 移动、裁剪、分割、删除、音量、透明度、淡入淡出和 Track 状态。
- Timeline 素材状态、交付前本地校验和缺失素材修复。
- Agent FFmpeg / ffprobe runtime、媒体探测、代理和波形派生能力。
- Project Asset Library 已支持 `CinemaAssetSourceSchema` 的 `render` 来源。
- 完整亮暗主题、760px 宽度保护、键盘路径、Axe 和 Playwright 基线。

### 2.2 需要纠正的旧设计描述

旧文档 `cinema-timeline-editor-design.md` 和部分架构说明仍包含以下过时描述：

- Edit 尚未启用。
- Timeline 使用浮点秒。
- UI selection / viewport 写入 Timeline 文档。
- render state 直接写回 Timeline。

Deliver 开发以当前 `@anybox/cinema-plugin/contracts/timeline`、已落地 Edit 实现和本文为事实来源。D0 必须同步更新旧文档，避免同时维护两套契约。

## 3. 目标与非目标

### 3.1 V1 目标

- 从 Deliver tab 选择一个已保存 Timeline。
- 展示服务端预检结果，而不是只依赖浏览器本地判断。
- 配置分辨率、帧率、画质/码率、音频码率和输出范围。
- 创建幂等、持久化、可取消的 render job。
- Agent 重启后能恢复 job 历史，并明确处理中断状态。
- 渲染过程中展示真实阶段和真实 FFmpeg 进度。
- 成功后原子地产生 MP4，不暴露半成品。
- 输出登记到项目 Asset Library 的“产出/视频”，不单独创建“导出”目录。
- 输出可用现有 asset preview 播放，并可再次用于 Create 或 Edit。
- Timeline 后续继续编辑不会改变已经创建的 job 输入。
- 失败、取消或中断不会留下伪成功资产。

### 3.2 V1 非目标

- 云端或分布式渲染。
- 多机队列、GPU 调度和农场管理。
- ProRes、DNxHR、AV1、透明通道等专业交付矩阵。
- HLS、DASH、字幕包、EDL、XML、AAF。
- 转场、调色、LUT、关键帧和复杂合成。
- 用户自定义 FFmpeg 参数或执行任意命令。
- 在浏览器内编码最终视频。
- Deliver 中修改 Timeline 结构。
- 自动发布到第三方平台。

## 4. Create / Edit / Deliver 最终边界

### Create

- 负责生成和组织稳定素材。
- 不创建 render job。

### Edit

- 负责 Timeline 内容、时间、轨道和基础属性。
- 负责提示“可交付”或阻塞原因。
- 不展示 FFmpeg 参数，不直接创建输出文件。

### Deliver

- 读取一个明确的 Timeline revision。
- 负责服务端预检、输出设置、render job 和输出资产。
- 不隐式修改 Timeline。
- 不用“重新渲染”掩盖 Timeline 已变化；必须清楚显示 job 使用的 revision。

## 5. 核心用户流程

### 5.1 从 Edit 进入 Deliver

1. 用户保存 Timeline。
2. Edit 确认 command queue 已 flush。
3. 用户点击 Deliver tab，或在“可交付”状态旁点击“打开 Deliver”。
4. 前端携带 `timelineID`，Deliver 读取最新持久化 revision。
5. Agent 执行服务端预检。
6. 预检通过后才启用“开始渲染”。

切换失败时停留在 Edit，并继续显示原保存错误和 Retry；不得绕过未保存命令直接创建 job。

### 5.2 首次渲染

1. 用户检查 Timeline、时长、分辨率、帧率和素材数量。
2. 用户选择预设或调整有限输出参数。
3. 点击“开始渲染”。
4. Agent 立即持久化 queued job，并返回 job ID。
5. 后台冻结 Timeline 和素材输入，再进入 FFmpeg 队列。
6. UI 展示 `queued → snapshotting → probing → rendering → registering → succeeded`。
7. 成功后展示输出资产、大小、时长和预览入口。

### 5.3 失败、取消和重试

- queued job 可立即取消。
- running job 取消时终止 FFmpeg，清理临时输出并写 canceled 事件。
- failed / interrupted job 展示稳定错误码、用户可读说明和诊断摘要。
- Retry 创建新的 job，带 `retryOfJobID`；旧 job 保持不可变，便于审计。
- 如果 Timeline 已更新，用户必须选择“使用原快照重试”或“从最新 Timeline 新建渲染”，不能静默替换输入。

### 5.4 Agent 重启

- queued job 可重新入队。
- 启动前处于 snapshotting / probing / rendering / registering 的 job 标记为 interrupted。
- V1 不自动重新执行 interrupted job，避免重复注册输出。
- UI 提供 Retry，并明确旧临时文件已清理或可安全清理。

## 6. Deliver 信息架构

### 6.1 桌面布局

```text
CinemaWorkbenchHeader: Create | Edit | Deliver
└─ DeliverWorkbench
   ├─ DeliverTopbar
   │  ├─ Timeline title + revision
   │  ├─ preflight status
   │  └─ current job status
   └─ DeliverBody
      ├─ DeliverSidebar (240–280px)
      │  ├─ Timelines
      │  └─ Render history
      ├─ DeliverMain (minmax(0, 1fr))
      │  ├─ output preview / poster
      │  ├─ preflight issues
      │  └─ progress and diagnostics
      └─ DeliverSettings (300–340px)
         ├─ preset
         ├─ video settings
         ├─ audio settings
         ├─ output range/name
         └─ Start render
```

### 6.2 窄窗口

- 900px 以下，Settings 变为右侧 drawer 或主区内可关闭 pane。
- 760px 以下沿用 Edit 的最小桌面宽度保护，不把三栏压成不可用卡片流。
- 页面本身不横向溢出；历史列表、问题列表和设置 pane 各自滚动。
- 长 Timeline 名称、job 名称、错误和输出文件名使用 ellipsis 或受控换行。

### 6.3 状态面

Deliver 必须显式覆盖：

- 无 Timeline。
- Timeline loading / load error。
- preflight checking / blocked / ready / warning。
- queued / snapshotting / probing / rendering / registering。
- succeeded / failed / canceled / interrupted。
- 输出资产 missing / deleted；服务端兼容的 `trashed` 状态在界面中统一表述为“已删除”。
- FFmpeg runtime unavailable。

不为这些状态创建嵌套装饰卡片；主区只展示当前最重要状态和下一步。

## 7. V1 渲染支持矩阵

服务端预检必须按矩阵判断，不支持的内容要阻塞并说明，不允许静默忽略。

| Timeline 能力 | Deliver V1 | 规则 |
| --- | --- | --- |
| V1 顺序视频 | 支持 | trim、source range、timeline gap、fit、opacity、playbackRate |
| V1 视频原音 | 支持 | clip volume、track mute；与 A1 混音 |
| A1 独立音频 | 支持 | trim、volume、fade in/out、playbackRate、track mute |
| O1 图片 | 支持 | contain/cover、opacity、timeline range |
| O1 视频 | V1 不支持 | 预检返回 `clip-unsupported`；留到 Deliver V1 公开启用后实现 |
| O1 文本 | V1 不支持 | 预检返回 `clip-unsupported`；字体打包与 drawtext 行为未锁定前不渲染 |
| hidden Track | 支持 | 不进入输出 |
| muted Track | 支持 | 音频不进入混音；视觉仍按 hidden 决定 |
| Timeline gap | 支持 | 使用 `backgroundColor` 和静音填充 |
| 非整数微秒 | 不可能 | Shared Schema 已拒绝 |
| 同 Track Clip 重叠 | 不可能 | Timeline Schema 已拒绝 |
| transition / LUT / keyframe | 不支持 | 当前 Schema 不持久化，Deliver 不自行发明 |

V1 的公开启用至少要求 V1 视频、视频原音、A1 音频和 O1 图片全部通过真实 FFmpeg E2E。

## 8. Shared Render 契约

建议新增：

```text
packages/shared/src/cinema-render.ts
packages/shared/src/cinema-render.test.ts
```

并通过 `@anybox/cinema-plugin/contracts/render` 导出。

### 8.1 时间与 ID

- 所有范围继续使用整数微秒。
- frame rate 复用 `CinemaTimelineFrameRateSchema`。
- `jobID`、`timelineID` 和 `operationID` 必须可做安全路径组件。
- 前端不能提交绝对输入路径和输出路径。

### 8.2 输出设置

```ts
type CinemaRenderSettings = {
  format: "mp4"
  videoCodec: "h264"
  audioCodec: "aac"
  width: number
  height: number
  frameRate: CinemaTimelineFrameRate
  quality: {
    mode: "balanced" | "quality" | "target-bitrate"
    targetVideoBitrateKbps?: number
  }
  audioBitrateKbps: 128 | 192 | 256 | 320
  range:
    | { type: "full" }
    | { type: "custom"; startUs: number; endUs: number }
  outputName: string
}
```

约束：

- width / height 为正偶数，并设合理上限。
- custom range 必须满足 `0 <= startUs < endUs <= timelineDurationUs`。
- target bitrate 只在对应模式存在。
- outputName 只表示显示名，不允许路径分隔符、保留名或扩展名注入。
- 第一版预设建议为 1080p Balanced、1080p Quality 和 Timeline Native。

### 8.3 Preflight

```ts
type CinemaRenderPreflightResult = {
  timelineID: string
  timelineRevision: number
  checkedAt: string
  ready: boolean
  durationUs: number
  estimatedFrameCount: number
  estimatedInputBytes: number
  estimatedWorkingBytes?: number
  issues: Array<{
    code: string
    severity: "error" | "warning"
    message: string
    clipID?: string
    assetID?: string
  }>
  support: {
    videoClips: number
    audioClips: number
    imageClips: number
    textClips: number
  }
}
```

API 响应不暴露绝对路径、FFmpeg 完整命令、环境变量或密钥。

### 8.4 Render Job

```ts
type CinemaRenderJobStatus =
  | "queued"
  | "snapshotting"
  | "probing"
  | "rendering"
  | "registering"
  | "succeeded"
  | "failed"
  | "canceled"
  | "interrupted"

type CinemaRenderJob = {
  schemaVersion: 1
  id: string
  projectID: string
  timelineID: string
  timelineRevision: number
  operationID: string
  retryOfJobID?: string
  status: CinemaRenderJobStatus
  settings: CinemaRenderSettings
  executionRuntime?: {
    runtimeID: string
    ffmpegVersion: string
    platform: "win32" | "darwin" | "linux"
    videoEncoder: "libx264" | "h264_mf" | "h264_videotoolbox"
    audioEncoder: "aac"
  }
  progress: {
    phase: CinemaRenderJobStatus
    percent?: number
    renderedUs?: number
    message?: string
  }
  outputAssetRef?: CinemaAssetRef
  error?: {
    code: string
    message: string
    retryable: boolean
    diagnosticSummary?: {
      phase: "queued" | "snapshotting" | "probing" | "rendering" | "registering" | "unknown"
      runtime?: {
        runtimeID: string
        ffmpegVersion: string
        platform: "win32" | "darwin" | "linux"
        videoEncoder: "libx264" | "h264_mf" | "h264_videotoolbox"
        audioEncoder: "aac"
      }
    }
  }
  createdAt: string
  startedAt?: string
  finishedAt?: string
  updatedAt: string
}
```

Job 不保存绝对 `inputTimelinePath`，也不向前端返回 `ffmpegCommandPreview`。`executionRuntime` 只保存脱敏 runtime identity、版本、平台和实际 encoder，不保存二进制路径或命令。该字段在 schemaVersion 1 中保持 optional，以读取旧 job；旧 queued job 仅在第一次执行时兼容绑定并写 `runtime-bound` 事件。failed job 必须带 error；旧 schemaVersion 1 interrupted job 可无 error，但新的重启恢复写入专用 `render-interrupted` error；其他状态禁止 error，且 `render-interrupted` 不得用于 failed。`diagnosticSummary` 只保存失败/中断前阶段和同一份脱敏 runtime facts，不保存 stderr、路径、命令、filter graph、环境变量或 secrets。

### 8.5 Job Event

事件至少包含：

- job-created
- snapshot-started / snapshot-completed
- probe-completed
- render-started / render-progress
- registration-started
- render-succeeded
- render-failed
- render-canceled
- render-interrupted

Progress event 必须节流，不能把每个 FFmpeg progress line 写入 JSONL。

## 9. 文件与资产布局

建议使用：

```text
.anybox-cinema/
  render-jobs/
    job_<jobID>/
      job.json
      timeline.json
      events.jsonl
      inputs/
        <assetID>_<contentRevision>.<ext>
      output.tmp.mp4
  render-queue.json

assets/library/
  产出/
    视频/
      <outputName>.mp4
```

规则：

- `job.json` 原子写。
- `timeline.json` 是 job 创建时的不可变快照。
- 输入优先使用同卷 hardlink，失败后安全 copy；personal asset 必须 copy 到 job sandbox。
- 所有输入验证 realpath、symlink 和允许范围。
- FFmpeg 只读取 job sandbox，不直接依赖渲染期间可能移动的素材路径。
- 临时输出只存在 job sandbox；成功后才登记 Asset Library。
- Asset Library 复用 `generated-videos` 系统目录，登记时使用 `source: "render"`。
- 注册成功后 job 保存稳定 `CinemaAssetRef`，不保存最终物理路径作为身份。
- canceled / failed job 不创建资产记录。
- 成功 job 的输入 sandbox 只按调用方显式提供的保留期清理；`dryRun` 先返回候选与预计回收量，确认执行后也只删除可重建输入和临时文件，不删除 job、事件、Timeline 快照或输出资产。当前不提供默认保留期和自动调度。

## 10. Agent API

```text
GET  /api/cinema/projects/:projectID/timelines/:timelineID/delivery-preflight
GET  /api/cinema/render-runtime

POST /api/cinema/projects/:projectID/timelines/:timelineID/render-jobs
GET  /api/cinema/projects/:projectID/timelines/:timelineID/render-jobs

GET  /api/cinema/projects/:projectID/render-jobs/:jobID
GET  /api/cinema/projects/:projectID/render-jobs/:jobID/events
POST /api/cinema/projects/:projectID/render-jobs/:jobID/cancel
POST /api/cinema/projects/:projectID/render-jobs/:jobID/retry
POST /api/cinema/projects/:projectID/render-retention/cleanup
```

### 10.1 Create body

```ts
type CreateCinemaRenderJobBody = {
  operationID: string
  expectedTimelineRevision: number
  settings: CinemaRenderSettings
}
```

语义：

- 同 `operationID` 重试返回同一个 job。
- Timeline revision 不匹配返回 409 和最新 revision。
- preflight blocked 返回 409 和结构化 issues。
- Create 请求只负责持久化 queued job，不等待复制输入或 FFmpeg，正常 ACK 目标小于 200ms。

### 10.2 Cancel

- queued：原子标记 canceled，并从队列移除。
- running：发出取消信号，等待进程退出；超时后强制终止。
- terminal status：返回幂等结果，不重复写事件。

### 10.3 Retry

- 生成新 job ID 和 operationID。
- 默认使用原 job 的 Timeline snapshot 与 settings。
- 用户选择最新 Timeline 时走新的 create API，不复用 Retry。

### 10.4 Retention cleanup

- body 使用 strict Schema，必须显式提供安全唯一的 `operationID` 和正整数 `retentionDurationMs`；不存在默认保留期。
- `dryRun` 缺省为 `true`，只返回候选 job、允许清理的 target 和保守的预计回收字节数，不删除数据。
- 执行必须同时提供 `dryRun: false` 与 `confirm: "DELETE_REBUILDABLE_RENDER_FILES"`。
- operation journal 持久化防止误重放：相同 ID 重放返回稳定 409，不同 payload 复用同一 ID 返回 conflict；预览与执行使用不同 ID。
- cleanup 与 render create/retry 共用项目级锁，且只删除旧 terminal job 的 `inputs/`、`.inputs.<id>.tmp/` 和 `output.tmp.mp4`。响应不包含绝对路径。
- 技术预览 UI 不提供默认值，要求每次输入正整数天数，先执行可取消的 dry-run，再输入 `CLEAN` 明确确认；执行提交后不可取消。
- Execute 仅允许 loopback Agent；浏览器必须来自 Agent 自身 Origin 或显式配置的 `ANYBOX_CINEMA_WEB_DEV_URL` Origin。该边界阻断任意网页/CSRF，但明确不声称隔离同一 OS 用户的本地进程。
- 不自动调度；[V1 保留策略与授权决策](./cinema-render-retention-policy-decision.md)仍须产品和安全负责人批准后才能用于公开发布。

## 11. Agent 模块拆分

建议新增：

```text
packages/anyboxagent/src/cinema/render-storage.ts
packages/anyboxagent/src/cinema/render-preflight.ts
packages/anyboxagent/src/cinema/render-snapshot.ts
packages/anyboxagent/src/cinema/render-graph.ts
packages/anyboxagent/src/cinema/render-runner.ts
packages/anyboxagent/src/cinema/render-queue.ts
```

职责：

- `render-storage`：安全路径、list/read/write、原子状态和事件。
- `render-preflight`：Timeline、asset revision、metadata、支持矩阵、磁盘估算。
- `render-snapshot`：冻结 Timeline 和输入文件，处理 hardlink/copy。
- `render-graph`：纯函数生成输入描述和 FFmpeg filter graph。
- `render-runner`：启动进程、解析 progress、取消、超时和临时文件。
- `render-queue`：并发上限、持久队列、重启恢复和生命周期编排。

不要继续把渲染实现全部堆入 `server/usecases/cinema.ts`。

## 12. FFmpeg V1 实现

### 12.1 视频主链

1. 按 V1 Clip 时间排序。
2. 对每个 Clip 应用 source trim。
3. 应用 playbackRate 和目标 duration。
4. 按 contain/cover 生成 scale + pad/crop。
5. 应用 opacity 和目标 pixel format。
6. Timeline gap 使用背景色视频填充。
7. 拼接为连续主视频。
8. 将 O1 图片按时间范围 overlay。
9. 统一 fps、尺寸、timebase 和 `yuv420p`。

### 12.2 音频主链

1. 提取未 muted V1 视频原音。
2. 处理 source trim、playbackRate 和 clip volume。
3. 处理 A1 音频 trim、volume、fade in/out。
4. 按 timelineStartUs 添加 delay。
5. 混音并限制到输出 range。
6. 没有任何音频时明确生成静音轨，保证 MP4 契约稳定。
7. 统一 sample rate 和 channel layout 后编码 AAC。

### 12.3 进度

- 使用 FFmpeg `-progress pipe:1 -nostats`。
- 以 `out_time_us / outputDurationUs` 计算真实百分比。
- 持久化频率不高于 4Hz，或仅在百分比至少变化 1% 时写入。
- UI 不自行模拟进度。

### 12.4 安全

- `spawn` 使用参数数组和 `shell: false`。
- 用户输入永远不拼接为命令字符串。
- 限制输出尺寸、帧率、码率、时长和输入数量。
- FFmpeg stderr 限制最大保留字节数。
- 日志和 API 错误不泄漏绝对路径、环境变量和密钥。

### 12.5 FFmpeg 分发与能力发现

Deliver 公开启用不能假设用户机器的 `PATH` 已安装 FFmpeg。D0–D5 必须明确生产运行时方案：

- 开发环境继续支持 `ANYBOX_FFMPEG_BINARY`、`ANYBOX_FFPROBE_BINARY` 和 PATH fallback。
- 桌面发行环境优先解析应用随附或 Anybox 管理的固定版本 runtime。
- Agent 暴露脱敏的 runtime status：available、version、platform、支持的 H.264/AAC encoder；不返回二进制绝对路径。
- 创建和 Retry job 在持久化 queued 状态前探测并锁定 `executionRuntime`；`job-created` 记录该绑定，Retry 创建新绑定且不改写旧 job。
- queue 执行前重新核对 runtimeID、FFmpeg 版本、平台和已锁定 H.264/AAC encoder，写 `runtime-bound` 审计事件，并把同一 encoder 交给 render graph；漂移时稳定失败，禁止静默切换 runtime/encoder。
- Windows、macOS 和 Linux 分别做带空格安装路径的启动与真实编码 smoke test。
- 打包 FFmpeg 前完成构建选项、许可证、notice、更新和安全响应方案确认；不能直接把开发机上的 GPL full build 复制进发行包。
- runtime 缺失时 Deliver 工作台仍可解释原因和修复路径，但 Start render 必须 disabled。

#### D0 分发与许可证决策

- 开发环境保留 `ANYBOX_FFMPEG_BINARY`、`ANYBOX_FFPROBE_BINARY` 和 PATH fallback；`GET /api/cinema/render-runtime` 只返回版本、平台与受支持 encoder，不返回二进制路径或原始启动错误。
- 桌面发行采用 Anybox 管理的、按平台固定版本 runtime；下载地址、版本、SHA-256、构建配置和许可证材料进入发布 manifest。D5 完成该解析顺序前，不能以开发机 PATH 通过作为公开启用依据。
- 禁止直接分发开发机上的 GPL/full build。默认候选必须完成 LGPL/GPL 构建选项、动态链接要求、第三方 notice、源码/修改提供义务、H.264 专利与各平台 encoder 条款审查。
- Windows 生产候选仅评估 runtime-probed `h264_mf`，并按[媒体 runtime 许可证审查简报](./cinema-media-runtime-license-review.md)使用 Anybox-controlled `--disable-libopenh264` 构建；macOS 优先评估 `h264_videotoolbox`。`libx264` 只有在 GPL 分发方案明确批准后才可进入生产 runtime。Linux 在合规 H.264 encoder 与分发来源获批前保持 `timelineDelivery: false`。
- runtime 更新必须可回滚且记录来源；安全响应时可替换 manifest 指向的固定版本，不静默采用系统中未知版本。

## 13. 队列、并发和可靠性

### 13.1 并发

- V1 默认全局只运行 1 个 FFmpeg render job。
- snapshot/probe 可以有限并行，但必须有 I/O 并发上限。
- 同一 Timeline 可排多个 job，但每个 job 使用独立 revision snapshot。
- Asset Library 注册沿用其 mutation revision 和写锁。

### 13.2 状态机

只允许：

```text
queued → snapshotting → probing → rendering → registering → succeeded
   └──────────────→ canceled
snapshotting/probing/rendering/registering → failed | canceled | interrupted
```

Terminal job 不回到 queued。Retry 总是创建新 job。

### 13.3 原子性

- job 先持久化，再加入内存队列。
- output.tmp 完成且 ffprobe 验证通过后才注册。
- Asset Library 注册失败时 job 保留 registering/failed 诊断，不能声称 succeeded。
- 注册成功后写 job succeeded；若最后一次 job 写入失败，恢复逻辑必须能从 operationID / asset checksum 识别已注册输出，避免重复资产。

## 14. 服务端预检

预检至少覆盖：

- Timeline 不为空且有可见主视频。
- Timeline revision 存在且 Schema 有效。
- 所有 assetRef scope、assetID、contentRevision、kind 一致。
- asset status 为 ready。
- source range 不超过实际 metadata。
- Track/Clip 能力在 V1 支持矩阵内。
- custom range 有有效视觉内容。
- FFmpeg / ffprobe 可用。
- 目标 H.264 / AAC encoder 在当前 runtime 中可用。
- 输出尺寸、fps 和码率在限制内。
- 预估工作空间可用。
- 输出名安全且可生成唯一文件名。

浏览器本地 `validateTimelineForDelivery` 继续提供即时提示，但创建 job 时必须重新执行服务端预检。

## 15. 前端实现

建议新增：

```text
packages/cinema-web/src/features/deliver/
  api/renderApi.ts
  components/DeliverWorkbench.tsx
  components/DeliverTopbar.tsx
  components/DeliverSidebar.tsx
  components/DeliverPreview.tsx
  components/DeliverSettings.tsx
  components/RenderProgress.tsx
  components/RenderHistory.tsx
  model/renderPresets.ts
  model/renderStatus.ts
  deliver.css
```

### 15.1 数据流

- Timeline list 复用 Timeline API。
- Preflight query key 包含 timelineID、revision 和 settings。
- Create render 使用 operationID，按钮重复点击不可创建两个 job。
- Active job 轮询建议 1 秒；terminal job 停止轮询。
- Project events 可用于后续实时推送，V1 不要求先引入新的 WebSocket 协议。
- Deliver 选择状态可写 URL 或本地 UI snapshot，但不能写回 Timeline。

### 15.2 UI 控件

- 每个 surface 只有“开始渲染”一个 primary action。
- Cancel 使用明确 danger 语义，但不做大面积红色填充。
- Retry 是 secondary；“从最新 Timeline 新建”是明确的新动作。
- Timeline / preset 使用既有 tabs、listbox 或 segmented 模式，不新增原生 `<select>` 风格分叉。
- job 历史使用紧凑 rows；进度用 progress + 邻近文本，不使用大 badge 卡片。
- icon-only 控件固定 28–30px，并有 `aria-label` 和 title。

### 15.3 主题规则

- `deliver.css` 只消费不带 `-light` / `-dark` 后缀的运行时 token。
- 缺少 render progress、success output、danger cancel 等语义 token 时，先在 `styles.css` token 区增加成对 light/dark 值，再映射运行时 token。
- 禁止在组件规则中新增 hex、固定白黑灰或 `rgba(...)`。
- default、hover、focus、active、disabled、selected、loading、error 和 success 必须在明暗主题下可读。
- focus 使用控件自身背景、边框、文字或指示器表达，不使用 outline / inset ring。

## 16. 键盘与可访问性

### 16.1 键盘路径

| 按键 | 行为 |
| --- | --- |
| Tab / Shift+Tab | 在 Timeline、job、settings 和动作间移动 |
| Enter / Space | 激活当前 row、preset 或按钮 |
| Arrow Up / Down | 在支持 roving focus 的 Timeline / job 列表移动 |
| Escape | 关闭 drawer、dialog 或错误详情 |
| Ctrl/Cmd + Enter | 预检 ready 且焦点不在输入框时创建 render job |

不为危险 Cancel 设置单键全局快捷键。

### 16.2 门槛

- tab、tabpanel、listbox、progressbar、status 和 alert 语义正确。
- progressbar 提供 `aria-valuenow`；无百分比阶段使用 status 文本。
- 动态阶段、成功和失败通过 live region 传达，但避免每秒重复朗读。
- danger 不能只靠红色或位置表达。
- 输出 poster/preview 有可访问名称。
- Axe 自动检查 0 violation，并人工检查完整键盘路径。

## 17. 开发阶段

### Phase D0：契约与文档校准（已完成）

交付：

- `cinema-render.ts` Shared Schema、类型和正反例测试。
- Job 状态机、预检 issue code 和输出设置上限。
- Render API client 接口和 Agent route 占位。
- `timelineDelivery` 保持 false；增加开发开关进入 Deliver。
- 更新旧 Timeline / 架构文档的过时状态和浮点秒描述。

验收：

- 非法 range、尺寸、fps、码率、ID、状态转换被拒绝。
- 旧 Timeline 无需迁移。
- Deliver 正常项目仍 disabled。

### Phase D1：存储、快照与预检（已完成）

交付：

- render job 安全路径、atomic write、list/read 和 events。
- Timeline revision 冻结。
- asset input hardlink/copy snapshot。
- 服务端 preflight 和支持矩阵。
- FFmpeg runtime status、编码器能力探测和发行方案决策。
- Agent 重启时 queued / interrupted 恢复逻辑。

验收：

- Timeline 在 job 创建后修改，不影响旧 job snapshot。
- 素材移动/改名不影响已完成 snapshot。
- missing、内部 `trashed`、stale revision、personal asset 和磁盘不足有结构化结果；前端不得把内部 `trashed` 暴露成可浏览的回收站。
- 路径穿越、symlink 和绝对路径泄漏测试通过。

### Phase D2：FFmpeg Render Core（已完成）

交付：

- 纯函数 render plan / filter graph builder。
- V1 视频、gap、fit、trim、rate 和图片 overlay。
- 视频原音 + A1 音频、volume、mute 和 fades。
- 真进度解析、取消、超时和临时文件清理。
- 输出 ffprobe 验证。

验收：

- 合成视频时长、尺寸、fps 和音频流符合预期。
- 连续视频边界、gap、range 和淡入淡出通过自动测试。
- 取消后无 FFmpeg 子进程和半成品资产。

### Phase D3：Job 生命周期与输出资产（已完成）

交付：

- 持久 render queue 和并发上限。
- create/cancel/retry/list/get/events API。
- operationID 幂等、revision 409 和 restart recovery。
- Asset Library `generated-videos` 系统目录。
- 成功输出以 `source: "render"` 注册并写回 job。
- 评估并决定 O1 video / text 的 V1 支持或明确阻塞。

验收：

- 响应丢失重试不创建重复 job 或重复输出资产。
- 两个 job 不会突破并发上限。
- 注册失败不产生伪成功。
- 输出可被现有 asset preview Range 播放。

### Phase D4：Deliver 工作台（5–7 日）

交付：

- DeliverTopbar、Sidebar、Main、Settings、Progress、History。
- Edit → Deliver timelineID handoff 和 flush。
- presets、preflight issues、create/cancel/retry。
- 成功输出 preview 和素材库定位。
- 亮暗主题、900px 折叠和 760px 宽度保护。
- Deliver 按需加载，切回 Edit / Create 时卸载重型预览 DOM。

验收：

- 不使用模拟进度和伪成功输出。
- 明暗主题通过 Axe 和对比度检查。
- failed/canceled/interrupted 都有下一步。
- 长名称、错误和窄窗口无页面横向溢出。

### Phase D5：发布加固并启用 Deliver（4–6 日）

交付：

- 真实项目 Playwright E2E。
- Agent crash、FFmpeg failure、磁盘/权限和取消故障注入。
- Windows/macOS/Linux runtime 发现、打包路径和编码 smoke test。
- 大 Timeline preflight 性能和长任务进度节流测试。
- 迁移、保留期、诊断和支持矩阵文档。
- `timelineDelivery: true`。

验收：

- 本文第 18、19 节 P0 用例通过。
- Deliver 对正常项目启用。
- Edit 仍不出现直接 Export 按钮。

总估算：24–36 个有效开发日。估算用于排序，不是发布日期承诺。

## 18. 测试计划

### 18.1 Shared

- Render settings 正反例。
- 整数微秒 range 和 rational frame rate。
- Job 状态、progress、error、assetRef。
- operationID、timelineRevision、retryOfJobID、executionRuntime 及 legacy optional 兼容。
- API body/result strict schema。

### 18.2 Agent 单元

- 安全路径和原子写。
- 状态机非法跳转。
- 支持矩阵和 issue codes。
- render plan / filter graph snapshot。
- FFmpeg progress parser、stderr limit、timeout 和 cancel。
- gap、trim、rate、fit、opacity、volume、mute、fade 的时间计算。

### 18.3 Agent 集成

- 用 FFmpeg 生成短 MP4/WAV/PNG fixture，再真实渲染。
- 输出 duration、width、height、fps、codec 和 audio stream ffprobe 断言。
- Unicode / 空格文件名和项目路径。
- project / personal asset snapshot。
- missing / 内部 `trashed` / stale contentRevision；`trashed` 的用户文案为“已删除”。
- Timeline revision conflict。
- 相同 operationID 幂等。
- 单并发队列、queued cancel、running cancel。
- Agent restart：queued 恢复、running 变 interrupted。
- 注册成功、注册失败、响应丢失恢复。
- 事件和 API 不包含绝对路径或密钥。

### 18.4 前端单元与组件

- preset → settings 映射。
- preflight ready / blocked / warning。
- job status → UI state 和可用动作。
- create mutation 防重复。
- active job polling 启停。
- Timeline revision changed 提示。
- empty/loading/error/success/canceled/interrupted。
- Settings 表单校验和键盘提交。

### 18.5 Playwright P0

1. 从 Edit 保存并进入 Deliver，打开同一 timelineID/revision。
2. 预检 blocked 时 Start render disabled，并显示可修复 issue。
3. 三段视频 + A1 + 图片 overlay 预检通过。
4. 创建 job 后显示真实 queued/running 进度。
5. 成功后输出资产可播放。
6. 刷新页面后 job 历史和成功输出仍存在。
7. Timeline 在 job 创建后修改，旧 job 仍显示旧 revision。
8. 相同 operationID 重试不重复创建。
9. queued 和 running job 均可取消。
10. 强制 FFmpeg 失败后展示 retryable error，并可 Retry。
11. Agent 重启后 interrupted job 可见且可重试。
12. 输出注册失败时没有伪成功资产。
13. 亮色、暗色、1280px、900px、760px 和 759px gate。
14. Axe 0 violation，键盘可完成预检、设置和创建 job。

## 19. 性能与资源目标

| 指标 | 目标 |
| --- | --- |
| 500 Clip 服务端 preflight | 本地项目小于 1 秒；不重复 ffprobe 已知 metadata |
| Create job ACK | 正常本地场景 p95 小于 200ms |
| Active job UI 状态延迟 | 小于 2 秒 |
| Progress 持久化 | 不高于 4Hz，且无无效重复写 |
| queued cancel ACK | 小于 200ms |
| running cancel 到进程退出 | 正常小于 3 秒，超时强制终止 |
| Job 历史首屏 | 1000 条记录下小于 1 秒并虚拟化 |
| 内存 | 不把完整媒体读入 Agent 或浏览器内存 |

渲染倍速受编码器、分辨率和机器影响，不设统一发布门槛；测试记录 realtime factor 和峰值资源，用于回归比较。

## 20. 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 浏览器预览与 FFmpeg 不一致 | 用户不信任输出 | 明确支持矩阵；真实媒体金样测试；不支持时阻塞 |
| Timeline 渲染中被修改 | 输出不可复现 | job 冻结 revision、Timeline 和输入 snapshot |
| 素材被移动或删除 | FFmpeg 中途失败 | sandbox hardlink/copy，不直接读取活动库路径 |
| 大素材 snapshot 占磁盘 | 磁盘耗尽 | hardlink 优先、工作空间估算、保留期和清理 |
| FFmpeg 进程遗留 | 资源持续占用 | AbortSignal、超时、终止升级和 orphan 测试 |
| 注册成功但 job 写失败 | 重复输出 | operationID + checksum 恢复和幂等注册 |
| 高频 progress 写盘 | I/O 和事件膨胀 | 4Hz / 1% 节流 |
| 过早支持复杂多轨 | 周期失控 | V1 支持矩阵，未知能力预检阻塞 |
| UI 做成导出设置大表单 | 扫描效率差 | presets 优先、紧凑 pane、隐藏高级参数 |
| 暴露 FFmpeg 命令 | 路径/安全泄漏 | 只返回稳定错误码和脱敏摘要 |

## 21. Deliver 公开启用清单

以下全部满足后才设置 `timelineDelivery: true`：

- [x] Shared Render Schema、状态机和 strict tests 完成。
- [x] Job storage、atomic write、events、queue 和 restart recovery 完成。
- [x] Timeline revision 与输入素材 snapshot 可复现。
- [x] 服务端 preflight 覆盖素材、能力、runtime 和磁盘。
- [ ] 生产 FFmpeg runtime 分发、能力探测、许可证和跨平台 smoke test 完成。
- [x] V1 视频、视频原音、A1 和图片 overlay 真实 FFmpeg 渲染通过。
- [x] Create / cancel / retry 幂等与失败恢复通过。
- [x] Create / Retry 在入队前绑定脱敏 executionRuntime；queue 漂移校验与 `runtime-bound` 审计事件完成，不静默替换 encoder。
- [x] 成功输出只在验证后注册为 `source: "render"` 资产。
- [x] 失败和取消不留下半成品资产或孤儿进程。
- [x] Deliver UI 没有模拟进度、伪成功或任意 FFmpeg 参数入口。
- [x] Edit → Deliver flush、timelineID 和 revision handoff 通过。
- [x] 亮色、暗色、760px–桌面宽度和 Axe 通过。
- [x] 键盘主路径和 live region 通过。
- [x] 500 Clip preflight 与 job 历史性能通过（1000 jobs：API + JSON 214.9ms，首个虚拟行 668.6ms，DOM 仅 11 个 option）。
- [x] Playwright 应用层 P0 和确定性故障注入通过（14 个 Deliver 场景）。
- [ ] 随安装包执行真实 Agent 进程 kill/restart 与恢复 smoke。
- [x] 旧文档、迁移说明、支持矩阵和保留期文档已同步。
- [x] 为安全 cleanup core 提供默认 dry-run、显式确认、operationID 防重放的项目级 API。
- [x] 提供不设默认值的技术预览运维入口、可取消 dry-run、明确确认、loopback/Origin 执行边界与脱敏聚合 telemetry。
- [ ] 产品和安全负责人批准或替换保留期、授权、确认、取消/进度、telemetry 与无调度策略。

## 22. 第一批可直接创建的任务

1. [x] `D0-01`：新增 Shared Render settings、preflight、job、event Schema。
2. [x] `D0-02`：定义 job 状态机、错误码和 V1 支持矩阵测试。
3. [x] `D0-03`：新增 `timelineDelivery` 开发开关和 Deliver shell 空状态。
4. [x] `D0-04`：定义 FFmpeg runtime status、编码器探测和发行/许可证方案。
5. [x] `D0-05`：修正旧文档中的 Edit disabled、浮点秒和 renderState 描述。
6. [x] `D1-01`：实现 render job path、atomic read/write/list/events。
7. [x] `D1-02`：实现 Timeline revision snapshot 和 asset input hardlink/copy。
8. [x] `D1-03`：实现服务端 preflight 和结构化 issues。
9. [x] `D1-04`：实现 restart recovery 和 interrupted 状态。
10. [x] `D2-01`：实现纯函数 FFmpeg render plan / filter graph builder。
11. [x] `D2-02`：实现 V1 视频链、gap、fit、trim 和 range。
12. [x] `D2-03`：实现视频原音、A1 混音、volume、mute 和 fades。
13. [x] `D2-04`：实现真实 progress、cancel、timeout 和输出 ffprobe 验证。

Deliver 前端推进记录：

14. [x] `D4-01`：实现 `renderApi`，接入 Timeline、runtime、preflight 与 render job API，并对响应执行 Shared Schema 校验。
15. [x] `D4-02`：实现 Deliver Timeline 选择、revision/settings 预检和结构化 issue 展示。
16. [x] `D4-03`：实现 preset、输出设置、真实 job 创建幂等、active job 轮询、cancel、retry 和历史 rows。
17. [x] `D4-04`：实现成功输出 Asset preview、运行时不可用提示和失败/取消/中断的下一步操作。
18. [x] `D4-05`：实现 Edit → Deliver 的 Timeline handoff；切换前复用 Edit flush，Deliver 按需 lazy-load。
19. [x] `D4-06`：补齐 Deliver 明暗主题 token、900px 设置折叠和 760px 宽度保护。
20. [x] `D4-07`：补充 Deliver 单元测试，并通过现有 Cinema 单测、构建和 Playwright 回归。
21. [x] `D4-08`：补充真实 fixture 的 Deliver Playwright P0、Axe 0 violation 和真实输出预览验收。

D5 发布加固推进记录：

22. [x] `D5-01`：真实 fixture 验证 Deliver 的 preflight、Ctrl/Cmd+Enter 创建 job、Escape 关闭设置、输出预览和 900/760/759px gate。
23. [x] `D5-02`：增加 500 Clip 服务端 preflight 性能证据（唯一素材去重、结构化 support 计数、1 秒门槛）。
24. [ ] `D5-03`：完成 Windows x64 与 macOS arm64 生产 runtime manifest、许可证材料和跨平台编码 smoke。仓库已提交两个 Anybox-controlled artifact-pending 目标、固定源码 revision 的 LGPL 构建配方、候选摘要与 promotion、[许可证技术审查简报](./cinema-media-runtime-license-review.md)以及 release-strict 打包门禁；lock 不再引用第三方 BtbN/OpenH264 产物，也不写入虚构的未来摘要。approved target 还必须提供机器可读的 approver、approvedAt、证据引用和不可变镜像摘要。首个 approved runtime 必须有获批的 `timelineDelivery` 关闭回滚方案。Linux、macOS x64 和 Windows arm64 不进入生产 runtime matrix，保持 unsupported/disabled。
25. [ ] `D5-04`：补充 Agent crash、FFmpeg failure、磁盘/权限和 UI cancel 的 fixture 故障注入。真实 FFmpeg failure→Retry、queued/running UI cancel、interrupted recovery→Retry、ENOSPC、snapshot EACCES 和 registration rollback 均已通过；已提供强制 `publish=never` 的 Deliver preview wrapper、脱敏证据模板和只读证据验证器，仅保留随批准候选安装包真实 kill/restart 的人工/平台 smoke。
26. [x] `D5-05`：键盘主路径、live region、1000-job 性能与虚拟化、旧文档同步、[运维/迁移/支持 runbook](./cinema-deliver-operations.md) 和安全保留期 cleanup core 已完成。
27. [x] `D5-06`：提供项目级 retention cleanup API；默认 dry-run，执行要求固定确认词，operationID 持久化防重放，不设置默认保留期或自动调度。产品保留期策略、授权与用户/运维入口仍是生产发布门槛。
28. [x] `D5-07`：Create / Retry 在持久化 queued job 前绑定 runtimeID、版本、平台和实际 H.264/AAC encoder；queue 执行前复核并写 `runtime-bound`，漂移时稳定失败且不静默换 encoder。schemaVersion 1 旧 job 保持 optional，并在首次执行时兼容绑定。
29. [x] `D5-08`：收口 Deliver 参数与 revision 语义：非 rendering 阶段仅显示不定进度，不伪造百分比；Custom range 默认整条 Timeline；开放常用/原始帧率与 target bitrate；旧 revision 的 Retry 与最新 Timeline 新建渲染明确分流。
30. [x] `D5-09`：成功输出先实时核对 Asset 状态，missing/内部 `trashed`/404/加载失败不再声称 ready；`Show in Assets` 只定位仍可浏览的真实 scope、folder 和分页条目，已删除输出不暴露内部隔离目录，并引导重新渲染。failed 与新 interrupted job 同时展示稳定错误码和脱敏诊断摘要。
31. [x] `D5-10`：实现 Render retention 技术预览入口：每次显式输入正整数天数、可取消 dry-run、聚合结果、`CLEAN` 确认、fresh operationID、提交后不可取消；Execute 增加 loopback + 受信 Origin 防护并记录脱敏聚合 telemetry。正式策略审批仍保持未完成。
32. [x] `D5-11`：新增 Anybox-controlled Windows x64 / macOS arm64 FFmpeg 候选构建、候选摘要、lock promotion、通用 locked-archive preparer 和 archive 材料来源门禁；macOS target 在真实产物产生前显式为 `artifactStatus: pending`。
33. [x] `D5-12`：Agent 通过内部 `ANYBOX_CINEMA_TIMELINE_DELIVERY` 返回 capability；打包后的 Desktop 只在当前 win32/x64 或 darwin/arm64 manifest 同时为 release/license approved 时注入该开关，其他平台 fail closed。
34. [x] `D5-13`：新增双平台 signed candidate、完整制品清单、release evidence/approval matrix 与同步发布工作流。门禁要求同一桌面版本、commit 和 FFmpeg revision，两端均为 initial runtime，各自 encoder/runtimeID 与 approved lock 一致，所有安装/更新文件均受 SHA-256 manifest 约束，并在平台 runner 上绑定 Anybox Authenticode 证书与 Apple Team ID，验证 Gatekeeper/DMG notarization stapling；许可证、产品、安全和 rollback 记录缺一不可。Internal RC 使用独立 prerelease tag；公开发布同时更新 COS 下载清单、Windows generic updater feed 和 GitHub 双平台 Release。
35. [ ] `D5-14`：生成并镜像两个真实候选，完成 Windows Client `h264_mf` 与 Apple Silicon `h264_videotoolbox` 安装包 smoke、签名/公证、kill/restart 证据及许可证/产品/安全审批。
36. [x] `D5-15`：新增 Windows x64 与 Apple Silicon macOS 的非发布 Deliver Beta 通道。两个原生 runner 分别构建并 smoke 固定 FFmpeg revision，将二进制、许可证、notice、configure、源码元数据和构建配方一并装入 Beta 安装包；Beta runtime 使用二进制摘要身份、只允许 bundled strict discovery，界面明确显示 `Deliver Beta`，且工作流不签名、不公证、不写正式更新源。D5-14 仍只约束正式公开发布，不再阻止内部 Beta 使用。
37. [x] `D5-16`：Deliver Beta 入口默认开放，不再因正式 `timelineDelivery` capability 尚未批准而显示 `Soon`；进入工作台后仍以 runtime query 和 preflight fail closed。`VITE_CINEMA_DELIVER_BETA=0` 保留为紧急隐藏入口的构建级 kill switch。

## 23. Deliver V1 之后

完成 Deliver 后再根据输出反馈排序：

1. O1 video / text 的正式渲染支持。
2. Edit marker、range selection 和 Deliver range handoff。
3. Timeline 重命名、轨道管理和文本 Clip 创建 UI。
4. 转场和关键帧的数据模型，不先做纯 UI。
5. 多音轨、ducking、响度标准化和音频表。
6. 更多交付 preset、封面、字幕和平台模板。

高级 Edit 每增加一项，必须同时更新 Deliver 支持矩阵、预检和真实 FFmpeg 金样测试，避免再次形成“能预览但不能交付”的断层。
