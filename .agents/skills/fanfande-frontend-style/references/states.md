# States

## 基础状态

每个交互组件至少考虑：

- default
- hover
- focus-visible
- active/pressed
- selected/current
- disabled
- loading
- error

不要只实现默认态。

## 状态视觉

状态默认优先使用图标、dot、spinner、progress、语义色和固定位置表达。不要把常见状态做成文字 badge，例如 `Active`、`Paused`、`Needs review`、`Enabled` 这类短文本不应成为主要视觉。

图标状态必须有可访问名称，例如 `aria-label`、`title`、tooltip 或详情面板说明。图标语义要稳定：成功用 check，暂停用 pause，警告/待确认用 alert，运行中用 spinner/clock，错误用 x 或 alert。

只有在日志、审计、详情页、复杂状态枚举或图标无法可靠区分含义时，才显示状态文字。即便显示文字，也不要用高噪音 badge 堆满表格。

## Disabled

disabled 要降低可见强度并阻止交互。需要解释原因时用 tooltip、helper text 或 inline message，不要把原因直接塞进按钮。

## Readonly

readonly 与 disabled 不同。readonly 内容仍可选择、复制、聚焦时显示可读状态，不能像 disabled 一样完全灰掉。

## Error/Warning/Success/Info

语义状态使用 `--semantic-*` 或 `--seg-*` 对应 token。错误要说明下一步；警告要说明风险；成功反馈应短暂，不要长期占据主界面。

## Selected 与 Current

列表、导航、tab、tree 的当前项要清晰。selected 状态不要只靠颜色，最好结合背景、边框、左侧指示线、字体权重或 aria-current。

## Loading 与 Busy

loading 不能导致控件尺寸变化。按钮 loading 保持原宽度；列表 loading 使用 skeleton；长任务使用进度或日志。

## Conflict

当多个状态同时存在时，优先级通常为 disabled > loading > error > selected > hover。危险状态和选中状态同时存在时，要保持危险语义可见。
