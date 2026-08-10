# Cinema Provider Model JSON Format

本文档说明 Cinema 本地 Provider Manifest 中单个模型 JSON 文件的写法。
参考标准文件：

```text
plugins/Anybox-Plugins/cinema/src/domain/provider-manifests/klingai-cn/models/kling-v3.json
```

适用文件位置：

```text
plugins/Anybox-Plugins/cinema/src/domain/provider-manifests/<provider-id>/models/<model-id>.json
```

Provider 根 manifest 通过 `models.includes` 引用这些模型文件：

```json
{
  "models": {
    "includes": [
      "./models/kling-v3.json"
    ]
  }
}
```

## 基本约定

模型 JSON 使用 camelCase 字段，并会被包装进 `CinemaVideoProviderManifestSchema` 的 `models[]` 里校验。不要把外部 catalog 的 snake_case 字段直接写进本地模型 JSON。

最小可通过校验的模型：

```json
{
  "id": "sample-video",
  "label": "Sample Video",
  "modes": ["text-to-video"]
}
```

实际可用模型建议至少补齐 `providerModelID`、`offeringID`、`modalities`、`inputCombinations`、`sourceURL` 和 `sourceCheckedAt`。

## 顶层字段

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 是 | 本地模型 ID。通常与 Provider API 的模型名保持一致。 |
| `label` | string | 是 | UI 展示名称。 |
| `offeringID` | string | 否 | Anybox 侧稳定选择 ID，建议格式为 `<provider-id>/<model-slug>`。前端优先用它作为模型选择值。 |
| `providerModelID` | string | 否 | 传给 Provider API 的模型 ID。缺省时运行时会回退到 `id`。 |
| `catalogID` | string | 否 | catalog 侧稳定 ID。通常与 `offeringID` 一致。 |
| `family` | string | 否 | 模型家族，例如 `Kling`。 |
| `lab` | string | 否 | 模型厂商或实验室，例如 `kuaishou`。 |
| `baseModel` | string | 否 | 更规范的基础模型标识，例如 `kuaishou/kling-3.0`。 |
| `endpointType` | string | 否 | 端点形态，例如 `async_polling`。 |
| `modalities` | object | 否 | 输入/输出模态声明。 |
| `modes` | string[] | 是 | 模型支持的生成模式。至少一个。 |
| `durations` | number[] | 否 | 顶层时长选项，当前会作为 `inputCombinations[].inputs` 中 `duration.options` 的 fallback。 |
| `aspectRatios` | string[] | 否 | 顶层比例选项，作为 `aspect_ratio.options` 的 fallback。 |
| `resolutions` | string[] | 否 | 顶层分辨率/质量选项，作为 `quality_mode`、`mode`、`resolution` options 的 fallback。 |
| `maxDurationSeconds` | number | 否 | 最大时长。 |
| `inputCombinations` | object[] | 否 | 模式、输入、端点的核心声明。视频生成 UI 主要依赖它。 |
| `pricing` | object[] | 否 | 价格说明。未知时使用 `unit: "unknown"` 并写明需查文档。 |
| `sourceURL` | string | 否 | 模型信息来源 URL。 |
| `sourceCheckedAt` | string | 否 | 来源核对日期，建议使用 `YYYY-MM-DD`。 |
| `maxReferenceImages` | number | 否 | 最大参考图数量。也可从 `reference_image.maxCount` 推导。 |
| `supportsSeed` | boolean | 否 | 是否支持 seed。 |
| `supportsNegativePrompt` | boolean | 否 | 是否支持 negative prompt。 |
| `supportsAudio` | boolean | 否 | 是否生成音频。`kling-v3.json` 中为 `true`。 |
| `supportsFirstLastFrame` | boolean | 否 | 是否支持首尾帧。也可从同时存在 `first_frame_image` 和 `last_frame_image` 推导。 |
| `requiresPublicInputURL` | boolean | 否 | 输入素材是否必须是公网 URL。 |
| `supportsProviderUpload` | boolean | 否 | 是否支持先上传到 Provider。 |
| `taskQueryEndpoint` | object | 否 | 顶层任务查询端点。组合内 `endpoint.taskQuery` 优先表达具体模式。 |
| `parameterSchema` | object | 否 | 预留参数 schema。当前可写 `{}`。 |

`modalities` 格式：

```json
{
  "modalities": {
    "input": ["text", "image", "video"],
    "output": ["video", "audio"]
  }
}
```

## inputCombinations

`inputCombinations` 是模型文件最重要的部分。每个组合描述一种可提交任务：模式、端点、输入素材、参数和约束。

字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `mode` | string | 是 | 生成模式，例如 `text-to-video`、`image-to-video`。 |
| `label` | string | 否 | UI 展示名。缺省时前端会根据 `mode` 格式化。 |
| `requiredModalities` | string[] | 否 | 必需模态摘要。当前主要是元数据。 |
| `optionalModalities` | string[] | 否 | 可选模态摘要。当前主要是元数据。 |
| `endpoint` | object | 否 | 创建任务端点，可按组合覆盖。 |
| `inputs` | object[] | 否 | 此组合需要的文本、素材和参数。 |
| `requirements` | object[] | 否 | 跨输入约束，例如多个 role 至少提供一个。 |
| `note` | string | 否 | 维护说明。 |

端点格式：

```json
{
  "endpoint": {
    "method": "POST",
    "path": "/v1/videos/text2video",
    "taskQuery": {
      "method": "GET",
      "path": "/v1/videos/text2video/{taskID}"
    }
  }
}
```

`method` 支持 `GET`、`POST`、`PUT`、`PATCH`、`DELETE`、`HEAD`。`path` 是相对 Provider `baseURL` 的路径；如需绝对地址，可使用 `url`。`taskQuery.path` 可使用 `{taskID}` 占位符。

## inputs

`inputs` 中每一项声明一个用户输入、素材输入或参数输入。

基础字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `role` | string | 是 | 输入角色。前端和适配器会根据 role 做槽位和参数映射。 |
| `modality` | string | 是 | 输入模态。常用 `text`、`image`、`video`、`parameter`、`object`。 |
| `required` | boolean | 否 | 是否必填。缺省为 `false`。 |
| `minCount` | number | 否 | 最少数量。缺省为 `0`。 |
| `maxCount` | number | 否 | 最多数量。 |
| `note` | string | 否 | 输入说明。 |

当前 schema 对 input spec 使用 passthrough，因此可写 Provider/UI 扩展字段。`kling-v3.json` 已使用这些扩展：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `options` | array | 参数可选值。前端会从 `aspect_ratio`、`duration`、`quality_mode` 等 role 读取。 |
| `labels` | object | option value 到展示文案的映射，例如 `{ "std": "720P" }`。 |
| `default` | unknown | 默认值。不可见参数有 default 时会作为隐藏参数提交。 |
| `min` / `max` | number | 数值范围。当前更多是元数据，适配器可读取。 |
| `maxLength` | number | 文本长度限制。当前更多是元数据，适配器或 UI 可读取。 |
| `apiField` | string | 提交参数名映射。前端隐藏默认参数会优先使用它，否则使用 `role`。适配器仍需读取对应参数 key。 |
| `unsupportedModels` | string[] | 某字段不适用的 Provider 模型列表。当前更多是元数据。 |

常用 role：

| role | modality | 前端行为 |
| --- | --- | --- |
| `prompt` | `text` | 文本 prompt 输入。 |
| `negative_prompt` | `text` | 负面 prompt。当前如非必填且无专用控件，主要依赖默认值或适配器读取。 |
| `first_frame_image` | `image` | 首帧图片槽位。 |
| `last_frame_image` | `image` | 尾帧图片槽位。 |
| `reference_image` | `image` | 参考图槽位，可配合 `maxCount`。 |
| `source_image` / `image` | `image` | 普通源图槽位。 |
| `source_video` / `reference_video` | `video` | 视频输入槽位。 |
| `mask_image` | `image` | 遮罩图槽位。 |
| `aspect_ratio` | `parameter` | 比例控件。 |
| `duration` | `parameter` | 时长控件。 |
| `quality_mode` / `mode` / `resolution` | `parameter` | 分辨率或质量控件。 |
| `sound` | `parameter` | 音频开关参数。 |
| `cfg_scale` | `parameter` | CFG 参数。 |
| `camera_control` | `object` | 相机控制对象。 |
| `watermark_info` | `object` | 水印信息对象。 |

重要行为：

- 前端只会把可识别的必填输入转成可操作控件；未知且必填的 role 会阻止提交。
- `aspect_ratio`、`duration`、`quality_mode` 这类参数如果在组合内提供 `options`，会覆盖模型顶层的 `aspectRatios`、`durations`、`resolutions`。
- 不可见参数如果有 `default`，会在提交时进入 `parameters`；参数名取 `apiField`，没有 `apiField` 时取 `role`。
- 组合的 `mode` 应包含在顶层 `modes` 中。运行时也会用组合 mode 判断 Provider adapter 是否支持。

## 完整模板

下面模板可作为新模型文件起点。删除不适用的组合和字段后再提交。

```json
{
  "id": "provider-model-v1",
  "label": "Provider Model V1",
  "offeringID": "provider-id/provider-model-v1",
  "providerModelID": "provider-model-v1",
  "catalogID": "provider-id/provider-model-v1",
  "family": "Provider Model",
  "lab": "provider-lab",
  "baseModel": "provider-lab/provider-model-v1",
  "endpointType": "async_polling",
  "modalities": {
    "input": ["text", "image"],
    "output": ["video"]
  },
  "modes": [
    "text-to-video",
    "image-to-video"
  ],
  "inputCombinations": [
    {
      "mode": "text-to-video",
      "label": "Text to video",
      "endpoint": {
        "method": "POST",
        "path": "/v1/videos/text2video",
        "taskQuery": {
          "method": "GET",
          "path": "/v1/videos/text2video/{taskID}"
        }
      },
      "inputs": [
        {
          "role": "prompt",
          "modality": "text",
          "required": true,
          "minCount": 1,
          "maxCount": 1,
          "maxLength": 2500
        },
        {
          "role": "aspect_ratio",
          "modality": "parameter",
          "required": true,
          "minCount": 1,
          "maxCount": 1,
          "options": ["16:9", "9:16", "1:1"]
        },
        {
          "role": "duration",
          "modality": "parameter",
          "required": true,
          "minCount": 1,
          "maxCount": 1,
          "options": [5, 10],
          "max": 10
        },
        {
          "role": "quality_mode",
          "modality": "parameter",
          "required": false,
          "minCount": 1,
          "maxCount": 1,
          "default": "std",
          "options": ["std", "pro"],
          "labels": {
            "std": "720P",
            "pro": "1080P"
          },
          "apiField": "mode"
        }
      ]
    },
    {
      "mode": "image-to-video",
      "label": "Image to video",
      "endpoint": {
        "method": "POST",
        "path": "/v1/videos/image2video",
        "taskQuery": {
          "method": "GET",
          "path": "/v1/videos/image2video/{taskID}"
        }
      },
      "inputs": [
        {
          "role": "first_frame_image",
          "modality": "image",
          "required": true,
          "minCount": 1,
          "maxCount": 1
        },
        {
          "role": "prompt",
          "modality": "text",
          "required": false,
          "minCount": 0,
          "maxCount": 1,
          "maxLength": 2500
        },
        {
          "role": "aspect_ratio",
          "modality": "parameter",
          "required": true,
          "minCount": 1,
          "maxCount": 1,
          "options": ["16:9", "9:16", "1:1"]
        },
        {
          "role": "duration",
          "modality": "parameter",
          "required": true,
          "minCount": 1,
          "maxCount": 1,
          "options": [5, 10],
          "max": 10
        },
        {
          "role": "quality_mode",
          "modality": "parameter",
          "required": false,
          "minCount": 1,
          "maxCount": 1,
          "default": "std",
          "options": ["std", "pro"],
          "labels": {
            "std": "720P",
            "pro": "1080P"
          },
          "apiField": "mode"
        }
      ]
    }
  ],
  "pricing": [
    {
      "unit": "unknown",
      "note": "Pricing should be checked against current docs."
    }
  ],
  "sourceURL": "https://provider.example.com/docs/model",
  "sourceCheckedAt": "2026-07-08",
  "parameterSchema": {}
}
```

## 维护检查清单

1. JSON 必须是严格 JSON：无注释、无尾逗号。
2. `id` 在同一个 Provider 的 `models.includes` 内必须唯一。
3. `label` 和 `modes` 必须存在，`modes` 不能为空。
4. 新模型文件需加入对应 `provider.json` 的 `models.includes`。
5. 每个对用户可用的生成入口都应写成一个 `inputCombinations[]`。
6. 必填输入必须能被前端满足：文本、图片、视频槽位，或已支持的参数控件。
7. `endpoint.path` 和 `taskQuery.path` 应与当前 Provider 官方文档一致。
8. `sourceURL` 和 `sourceCheckedAt` 应随文档核对更新。
9. Provider adapter 必须能识别组合的 `mode` 或 `endpoint.path`。
10. 新增 Provider 特有字段时，确认前端或 adapter 已读取该字段；否则只把它当元数据。
