# Cinema Generation Form Contract TODO

## 背景

当前问题不只是 Kling Image v3 少几个 UI 控件，而是“模型能力、任务参数、UI 控件、provider payload”之间缺少清晰边界。

现状里：

- 专门的生图节点手写了 `prompt / style / size / count / model / reference images`。
- 通用 generation 节点部分读取 `inputCombinations`，但只支持少量参数控件。
- `CreateCinemaImageGenerationBodySchema` 仍写死 `size / count / style`，其中 `count` 全局限制为 `1-4`。
- Kling Image v3 Omni 这类模型需要 `resolution / aspect_ratio / result_type / count / series_amount / image_list` 等字段，但 UI 没有完整暴露。
- runtime adapter 已经开始识别 provider endpoint 和 payload 差异，但 UI 仍没有统一的参数来源。

目标不是做一个无限通用的 JSON 表单生成器，而是做一个受限、可维护的 Anybox 生成任务表单协议。

## 全局设计

推荐增加一层很薄的中间抽象：`GenerationFormSpec`。

数据流：

```txt
Provider Manifest
  -> normalizeGenerationFormSpec()
  -> Frontend Generation Controls
  -> Create Generation Task parameters
  -> Runtime Adapter provider payload
```

职责边界：

- Manifest：描述模型有哪些输入、默认值、范围、选项、输入组合。
- Form Contract：把 manifest 转成前端可渲染的有限控件集合。
- Frontend：只渲染 contract，不认识 Kling、Runway、Pika 等 provider 细节。
- Backend task usecase：接收通用 `parameters`，绑定模型和 input combination。
- Runtime Adapter：把通用 parameters 转成 provider API payload。

## 核心类型草案

新增或放在 shared/cinema 里的概念：

```ts
type GenerationFormSpec = {
  providerID: string
  modelID: string
  mode: string
  output: "image" | "video"
  controls: GenerationControl[]
}

type GenerationControl =
  | {
      type: "prompt"
      key: string
      label: string
      required: boolean
      maxLength?: number
      defaultValue?: string
    }
  | {
      type: "image-list"
      key: string
      label: string
      required: boolean
      minCount?: number
      maxCount?: number
      supportedFormats?: string[]
      maxFileSizeMB?: number
    }
  | {
      type: "select"
      key: string
      label: string
      required: boolean
      options: Array<string | number | boolean>
      labels?: Record<string, string>
      defaultValue?: unknown
      visibleWhen?: Record<string, unknown>
    }
  | {
      type: "number"
      key: string
      label: string
      required: boolean
      min?: number
      max?: number
      defaultValue?: number
      visibleWhen?: Record<string, unknown>
    }
  | {
      type: "boolean"
      key: string
      label: string
      required: boolean
      defaultValue?: boolean
      visibleWhen?: Record<string, unknown>
    }
  | {
      type: "json"
      key: string
      label: string
      required: boolean
      defaultValue?: unknown
      visibleWhen?: Record<string, unknown>
    }
```

原则：

- `key` 优先使用 manifest input 的 `apiField`，没有就使用 `role`。
- `options` 存在时优先渲染 `select` 或 segmented control。
- `min / max` 存在且无 options 时渲染 number input。
- `modality: "image"` 且 `maxCount > 1` 渲染 image-list。
- `modality: "object"` 第一阶段渲染 json 控件，后续再做专用资源选择器。
- `default` 同时用于初始值和提交兜底。

## Manifest 需要补充的轻量字段

现有 manifest 已经能表达大部分字段，但条件显示和 UI 顺序还不够机器可读。

建议逐步支持这些可选字段：

```ts
type ProviderInputUIMetadata = {
  uiControl?: "textarea" | "select" | "segmented" | "number" | "switch" | "image-list" | "json"
  uiGroup?: string
  uiOrder?: number
  visibleWhen?: Record<string, unknown>
  disabledWhen?: Record<string, unknown>
}
```

Kling Omni 示例：

```json
{
  "role": "count",
  "apiField": "count",
  "modality": "parameter",
  "default": 1,
  "min": 1,
  "max": 9,
  "visibleWhen": {
    "result_type": "single"
  }
}
```

```json
{
  "role": "series_amount",
  "apiField": "series_amount",
  "modality": "parameter",
  "default": 4,
  "options": [2, 3, 4, 5, 6, 7, 8, 9, "auto"],
  "visibleWhen": {
    "result_type": "series"
  }
}
```

## 第一阶段目标

先解决 Kling Image v3 Omni 的用户可配置字段暴露问题，不追求一次性覆盖所有 provider。

需要暴露：

- `prompt`
- `image_list`
- `resolution`
- `aspect_ratio`
- `result_type`
- `count`
- `series_amount`

暂缓：

- `element_list`：先可作为高级 JSON 控件，后续再做元素资产管理 UI。
- `watermark_info`：先可作为高级 JSON 或 boolean 控件，后续再细化。

## 实施计划

### 1. Shared 层定义 Form Contract

文件建议：

- `packages/shared/src/cinema.ts`

任务：

- 新增 `GenerationFormSpecSchema`。
- 新增 `GenerationControlSchema`。
- 给 provider input schema 增加可选 `uiControl / uiGroup / uiOrder / visibleWhen / disabledWhen`。
- 保持向后兼容，所有字段都 optional。

验收：

- `packages/shared/src/cinema.test.ts` 增加解析 `omni-image` form spec 的测试。
- `bun test src/cinema.test.ts` 通过。

### 2. Anybox Agent 层生成 Form Spec

文件建议：

- `packages/anyboxagent/src/cinema/provider-runtime.ts`
- 或新增 `packages/anyboxagent/src/cinema/provider-form.ts`

任务：

- 实现 `normalizeGenerationFormSpec(provider, model, combination)`。
- 根据 manifest input 推断 control type。
- 处理 default、options、min/max、maxCount、labels。
- 不写 provider 特例。

验收：

- Kling Image v3 Omni 能生成包含 `resolution / aspect_ratio / result_type / count / series_amount / image_list` 的 form spec。
- `image_list` control 的 `maxCount` 为 10。
- `count` control 的 `max` 为 9。

### 3. 前端增加通用 Control Renderer

文件建议：

- `packages/cinema-web/src/App.tsx`
- 后续可拆到 `packages/cinema-web/src/generationControls.tsx`

任务：

- 新增 `GenerationControlRenderer`。
- 支持 `prompt / image-list / select / number / boolean / json`。
- 支持 `visibleWhen`。
- 收集用户输入为 `parameters: Record<string, unknown>`。
- 保留现有媒体 asset 选择能力，不做纯 HTML 表单。

验收：

- 用户切换 `result_type` 时：
  - `single` 显示 `count`。
  - `series` 显示 `series_amount`。
- `resolution`、`aspect_ratio` 能从 manifest options 渲染。
- 多图参考图继续可选，最多 10 张。

### 4. 生图节点改成消费 Form Spec

文件建议：

- `packages/cinema-web/src/App.tsx`

任务：

- 保留 ImageGeneration 节点的图片预览、缩略图、资产管理。
- 参数区不再写死 `size / count / style`。
- 从 selected image model 的 form spec 渲染 controls。
- 提交时传 `parameters`，而不是只传 `size / count / style`。

验收：

- Kling Image v3 Omni 生图节点显示完整参数。
- 老的 text-to-image 模型仍能生成。
- 未提供 manifest controls 的模型有合理 fallback。

### 5. 后端生图请求支持通用 parameters

文件建议：

- `packages/shared/src/cinema.ts`
- `packages/anyboxagent/src/server/usecases/cinema.ts`

任务：

- `CreateCinemaImageGenerationBodySchema` 增加 `parameters: z.record(z.string(), z.unknown()).optional()`。
- 逐步弱化 `size / count / style` 的特殊地位。
- 继续兼容旧字段，把旧字段合并进 `parameters`。
- 通过 provider model 和 selected mode 找到 input combination。

验收：

- 前端提交 `resolution / aspect_ratio / result_type / count / series_amount` 后，后端 task input parameters 保留这些值。
- `count` 不再被全局限制为 `1-4`，而是由 form spec 或 provider adapter 校验。

### 6. Runtime Adapter 继续只处理 provider payload

文件建议：

- `packages/anyboxagent/src/cinema/provider-runtime.ts`

任务：

- Kling adapter 继续负责：
  - `count -> n`
  - `image_list` URL/base64 转换
  - `result_type=series` 时不发 `n`
  - `series_amount` 只在 series 时发送
  - `/v1/images/omni-image` endpoint 和 task query endpoint
- 不在 adapter 里处理 UI 显示逻辑。

验收：

- Omni payload 不包含视频参数 `mode/std/pro`。
- Omni payload 包含用户设置的 generation parameters。

## 风险和约束

- 不要把 UI 做成无限通用 JSON Schema form，否则会丢失 Anybox 的节点、连线、资产、多图选择语义。
- 不要在 React 里写 provider 特例，例如 `if provider === "klingai-cn"`。
- 不要让 manifest 直接决定视觉细节，只让它描述能力、约束和轻量 UI hint。
- 保持旧项目数据兼容，已有 `size / count / style` 字段不能立刻删除。
- `element_list` 涉及 Kling 元素资产管理 API，建议单独作为后续阶段处理。

## 推荐优先级

1. Shared schema 增加 Form Contract。
2. Agent 侧生成 form spec。
3. 前端先实现最少控件 renderer。
4. 生图节点消费 form spec。
5. 后端 image generation body 接受 generic parameters。
6. 再统一通用 generation 节点。

## 当前阶段完成标准

- Kling Image v3 Omni 生图节点不再只显示 `size/count/style`。
- 用户可以设置 `resolution / aspect_ratio / result_type / count / series_amount`。
- 用户可以选择最多 10 张参考图作为 `image_list`。
- 提交后的 task parameters 与 manifest input key 对齐。
- Kling runtime adapter 能消费这些 parameters 并生成正确 provider payload。
