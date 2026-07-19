# Chrome 插件运行时问题记录

状态：持续维护  
首次记录：2026-07-19  
适用范围：`packages/chrome-plugin`、`packages/shared`、`packages/anyboxagent` 以及由其生成的 Chrome 插件安装包

## 文档目的

本文用于持续记录 Anybox Chrome 插件在真实 Agent 任务中的运行时问题，重点保留：

- 可复现的用户任务与运行环境；
- 可核对的 trace、工具调用和源码证据；
- 时间与调用次数等量化数据；
- 已确认事实、合理推断和待确认问题之间的边界；
- 修复优先级、建议方案和验收标准。

新增问题应追加记录，不应在问题修复后删除历史证据。状态统一使用：

- `待处理`：问题已确认，尚未开始修复；
- `调查中`：证据不足或根因仍需验证；
- `修复中`：已有实现变更；
- `待验证`：修复已完成，尚未通过真实场景验证；
- `已解决`：已通过自动化测试和真实场景验证；
- `不修复`：经评审接受风险，并记录理由。

严重级别统一使用：

- `P0`：会导致错误地报告外部操作成功、安全边界失效或主要能力不可用；
- `P1`：显著降低成功率或造成分钟级额外耗时；
- `P2`：有明显资源浪费、可观测性缺口或体验问题；
- `P3`：低风险改进。

## 问题索引

| ID | 严重级别 | 状态 | 问题 |
| --- | --- | --- | --- |
| CHR-RUN-001 | P0 | 待处理 | 知乎自定义富文本编辑器未被稳定暴露为可交互元素 |
| CHR-RUN-002 | P1 | 待处理 | Agent 未读取 Runtime Documentation，转而猜测 API 签名 |
| CHR-RUN-003 | P0 | 待处理 | 工具生命周期成功掩盖了动作语义失败 |
| CHR-RUN-004 | P1 | 待处理 | 缺少重复失败检测和停止条件 |
| CHR-RUN-005 | P2 | 调查中 | 截图已生成，但模型未实际利用图像内容 |
| CHR-RUN-006 | P0 | 待处理 | 发布任务缺少因果验证，最终产生成功误报风险 |
| CHR-RUN-007 | P1 | 待处理 | 单步模型—工具串行循环和高频进度文字造成主要耗时 |
| CHR-RUN-008 | P1 | 调查中 | 相邻模型调用之间存在稳定的约 1.84 秒调度间隔 |

---

## 事件：2026-07-19 知乎发布想法

### 基本信息

| 字段 | 值 |
| --- | --- |
| 用户任务 | 使用 Chrome 在知乎发布动态“今天天天气不错” |
| Session ID | `ses_085f2eeafffeizvclLMq56U7R7` |
| Turn ID | `trn_f7a0d1a54001DueliN4wk5dfpD` |
| 执行时间 | 2026-07-19 19:05:07–19:10:26，Asia/Shanghai |
| 总耗时 | `319345 ms`，约 5 分 19 秒 |
| Agent 模型 | `deepseek/deepseek-v4-pro` |
| 执行模式 | `safe` |
| Chrome 插件版本 | trace 加载的 Skill 路径显示为 `chrome/0.5.0` |
| Extension backend | `0.1.1` |
| Protocol / Contract | protocol `1`，`contractCompatible: true` |
| 模型调用 | 33 次 |
| 工具调用 | 32 次，其中 Chrome 调用 31 次、Skill 加载 1 次 |

Trace 根目录：

```text
C:\Users\19128\AppData\Roaming\anybox-desktop-agent\session-traces\prj_2545c453dffeUQJSa0BTBguEV5\anybox-trace-ses_085f2eeafffeizvclLMq56U7R7-20260719-191052
```

关键入口：

- `runtime/turns/index.json`：总耗时、模型及调用次数；
- `tool-calls/index.json`：32 次工具调用及其耗时；
- `messages/index.json`：33 条 assistant message；
- `semantic-flow.md`：语义时间线；
- `event-flow.md`：638 条底层事件；
- `payloads/payload-000001-load_skill-...-output.txt`：本次实际加载的 Chrome Skill。

### 耗时拆分

模型调用 span 包含嵌套的工具执行时间。将工具时间从模型 span 中扣除后，得到：

| 类别 | 耗时 | 占总时长 |
| --- | ---: | ---: |
| 模型 / Provider 独占时间 | 约 `235150 ms` | 73.6% |
| Chrome 与 Skill 工具执行 | `23522 ms` | 7.4% |
| 模型调用之外的运行时调度 | `60673 ms` | 19.0% |
| 合计 | `319345 ms` | 100% |

进一步观察：

- 33 次模型调用 span 共 `258672 ms`；
- 从模型调用开始到首个 reasoning part 的累计等待为 `79556 ms`；
- reasoning 共 33 段、18867 字符、累计 `90640 ms`；
- 用户可见 text 共 27 段、962 字符、累计 `61279 ms`；
- 32 个相邻模型调用间隔累计 `58933 ms`；
- 相邻调用平均间隔 `1841.7 ms`，最短 `1597 ms`，最长 `2748 ms`；
- 工具输入中显式声明并实际进入的 sleep/selector timeout 约 `17000 ms`。

结论：主要耗时不是 Chrome 命令执行，而是大量串行模型调用、模型生成和相邻调用调度。

### 阶段时间线

| 阶段 | 相对时间 | 耗时 | 主要行为 |
| --- | ---: | ---: | --- |
| 连接与页面发现 | 0–36 秒 | 约 36 秒 | 加载 Skill、连接 Chrome、绑定知乎标签页、发现禁用的“发布”按钮 |
| 编辑器定位与 API 试错 | 36–208 秒 | 约 172 秒 | snapshot、DOM、AX、坐标、selector、fill、type、截图等多轮尝试 |
| 继续重试与页面绕行 | 208–289 秒 | 约 81 秒 | 再次扫描、点击“创作”、访问错误 URL、返回首页、重复坐标输入 |
| 验证与最终响应 | 289–319 秒 | 约 30 秒 | 在创作中心发现同名想法、首页验证失败、再次进入创作中心并报告成功 |

从首次确认“发布”按钮禁用，到创作中心出现同名内容，共约 253 秒，占总时长约 79%。

---

## CHR-RUN-001：自定义富文本编辑器未被稳定暴露

严重级别：`P0`  
状态：`待处理`

### 现象

Agent 可以识别知乎首页的“发布”按钮和其屏幕坐标，但无法获得对应编辑器的可操作引用：

- `interactiveSnapshot()` 返回 200 个元素，但没有可填充的编辑器；
- `domTree()` 搜索 `contentEditable`、`textbox` 等条件，返回 0 个编辑器；
- `accessibilityTree()` 返回 0 个输入元素；
- 常见 `contenteditable`、editor 和 input selector 返回空结果；
- 三次坐标点击并输入后，“发布”按钮仍为 `disabled: true`。

对应工具记录：

- `tool-calls/000012-...zupiDhUOVCj7W6Mhl8b11071.json`
- `tool-calls/000014-...znkn1LRzNJNrMv1HFO8a4066.json`
- `tool-calls/000015-...oePVF4QrBuoAHnv0nNuY4150.json`
- `tool-calls/000024-...PwPVWfqYlzhNcFSMYI7f5134.json`
- `tool-calls/000028-...KtFd3BciYiGQAUtHDhMe9463.json`
- `tool-calls/000029-...AFwqn2rxUorM8FKB4QiY5153.json`

### 已确认事实

当前 `interactiveSnapshot`：

- 默认最多返回 200 个元素，最大允许 500 个；
- 只扫描预定义 selector；
- 支持 `textarea`、`role=textbox` 和 `contenteditable`；
- 返回 `truncated`，但本次 Agent 只回传了 `elements.length`，没有检查该字段。

实现位置：

- [`browser-extension/src/background/commands.ts`](../browser-extension/src/background/commands.ts)，`interactiveSnapshot` 附近；
- [`browser-contract.ts`](../../shared/src/browser-contract.ts)，`BrowserPageInteractiveSnapshotParams` 附近。

### 合理推断

知乎输入区可能在激活前不是标准 `contenteditable`/textbox，或其可编辑节点未被当前 selector、可见性条件和元素上限稳定捕获。

### 影响

- 无法通过当前推荐的 `interactiveSnapshot → clickElement/fill` 路径完成操作；
- Agent 退化到不可靠的坐标猜测和未约束 selector；
- 直接触发 CHR-RUN-004 和 CHR-RUN-007；
- 发布类任务成功率不可控。

### 建议

1. 在 snapshot 中补充编辑器候选信息：
   - placeholder、`aria-placeholder`；
   - `ProseMirror`、Draft.js、Slate 等可编辑根节点特征；
   - 可点击但尚未变为 `contenteditable` 的 composer placeholder；
   - 元素的 `isContentEditable`、focusable、tabIndex 和最近可编辑祖先。
2. 当结果达到默认上限时，把 `truncated: true` 作为显著诊断信息返回给模型。
3. 增加按屏幕区域、文本邻近关系或容器范围查询交互元素的高层能力。
4. 为“激活 composer 后重新 snapshot”提供明确的推荐流程。

### 验收标准

- 在知乎首页能够获得稳定的 composer `elementId`；
- 能通过 `clickElement/fill` 或等价的高层命令使“发布”按钮从禁用变为启用；
- 不使用任意 page JavaScript、raw CDP 或未授权 selector adapter；
- 相同页面连续运行 10 次，编辑器定位成功率不低于 95%。

---

## CHR-RUN-002：未读取 Runtime Documentation，猜测 API 签名

严重级别：`P1`  
状态：`待处理`

### 现象

本次加载的 Chrome Skill 明确要求首次初始化时执行：

```js
nodeRepl.write(await chrome.documentation())
```

但 `tool-calls/000002-...IrAq9QkEZJ5m0nj4JS173059.json` 仅调用了：

```js
chrome.status()
chrome.tabs.list()
```

之后 Agent 开始猜测 API，出现：

- 把 `tab.click(x, y)` 写成 `tab.click({ x, y })`；
- scroll 参数不符合 contract v1；
- 使用不存在的 `tab.playwright.page.waitForSelector`；
- 假定 `waitForSelector` 返回值具有 `boundingBox()`；
- 探测 `tab.playwright` 方法后继续尝试被策略禁止的 selector click/fill。

正确 API 签名定义于：

- [`packages/shared/src/browser-contract.ts`](../../shared/src/browser-contract.ts)
- [`packages/chrome-plugin/browser-runtime/src/browser-client.ts`](../browser-runtime/src/browser-client.ts)

### 影响

- 至少产生 4 次可由文档直接避免的失败调用；
- Agent 在错误 API 假设上继续展开 reasoning；
- 增加模型轮次、上下文和用户等待时间。

### 建议

1. Runtime 初始化时由代码自动加载 documentation，不依赖模型自觉执行。
2. 在 Node REPL 初始化结果中提供紧凑的、类型化的高频命令签名。
3. 对错误参数返回正确签名和最小修复示例。
4. Skill 检测到 documentation 未读取时，不允许进入页面写操作。

### 验收标准

- 首次浏览器操作前，trace 中存在 documentation 加载证据；
- 不再出现 contract 参数形状猜测；
- 错误调用能在一次反馈后修正，不能重复试探同一 API。

---

## CHR-RUN-003：工具成功状态掩盖动作失败

严重级别：`P0`  
状态：`待处理`

### 现象

`tool-calls/index.json` 中 32 次调用的 `diagnosticStatus` 全部为 `ok`，但工具输出实际包含：

- `Browser command ... parameters do not match contract v1`
- `Cannot read properties of undefined`
- `el.boundingBox is not a function`
- `Page evaluation is disabled`
- `page.fill failed in the extension backend`
- `success: false`
- `disabled: true`
- 404 页面

工具生命周期完成只说明 MCP 正常返回，不等于浏览器动作成功。

### 影响

- 上层 Agent 无法可靠区分“调用完成”和“任务动作完成”；
- 失败统计、重试策略和 UI 状态会产生误导；
- 语义失败继续作为正常上下文进入下一轮推理。

### 建议

1. 把 transport、command 和 semantic outcome 分层记录：
   - `transportStatus`
   - `commandStatus`
   - `outcomeStatus`
2. Node REPL 返回结构化错误时设置 `diagnosticStatus: error/degraded`。
3. 对 `success: false`、明确的 `error` 字段和 contract mismatch 建立标准诊断。
4. `disabled: true` 本身不一定是工具错误，但在目标动作要求启用按钮时应由任务层判定为未达成。

### 验收标准

- 上述明确错误不会再显示为纯 `ok`；
- trace UI 可以筛选语义失败；
- 重试策略能够直接消费结构化错误类别。

---

## CHR-RUN-004：缺少重复失败检测和停止条件

严重级别：`P1`  
状态：`待处理`

### 现象

同一个核心结果被重复验证：

1. Playwright 坐标点击并键盘输入，按钮仍禁用；
2. 坐标点击并 `tab.type()`，按钮仍禁用；
3. 返回首页后再次坐标点击并键盘输入，按钮仍禁用。

期间还重复执行了 DOM、AX、selector、截图和页面扫描，但没有形成明确的失败预算。

### 影响

- 大约 253 秒被消耗在同一阻碍附近；
- 重复推理产生越来越长的上下文；
- 外部写操作任务可能在不确定状态下继续试错。

### 建议

1. 为同一目标建立 attempt fingerprint，例如：
   - 目标：使发布按钮启用；
   - 方法：坐标聚焦后输入；
   - 结果：按钮仍禁用。
2. 同一 fingerprint 连续失败 2–3 次后触发 stuck detector。
3. stuck 后只允许：
   - 使用具有新证据的新策略；
   - 请求用户进行必要交互；
   - 明确报告能力阻碍。
4. 对外部发布操作设置总尝试数和总耗时上限。

### 验收标准

- 相同失败策略最多重复一次；
- stuck 状态在 trace 中可见；
- 不能仅用改动坐标几个像素的方式规避重复检测。

---

## CHR-RUN-005：截图未被模型有效利用

严重级别：`P2`  
状态：`调查中`

### 现象

本次生成了四份大截图输出：

| 调用 | 输出体积 |
| --- | ---: |
| `call_00_UmSurAzEKEgsgipyLGrv3775` | 413.7 KB |
| `call_00_EgQTZW61cwbnrx6Pmwkm0985` | 458.9 KB |
| `call_00_PwPVWfqYlzhNcFSMYI7f5134` | 400.2 KB |
| `call_00_CsvpOJGHZvznSDMH4g4G2190` | 542.2 KB |

合计约 1.77 MB。模型 reasoning 同时出现“截图已经生成，但我无法查看”的明确表述，之后仍继续截图。

### 待确认

- 当前模型是否支持图像输入；
- MCP image attachment 是否实际进入模型上下文；
- 持久化大输出的 preview 是否被误当成可视化结果；
- 大型 image payload 是否增加后续模型首 token 延迟。

### 建议

1. 模型不支持视觉输入时，不暴露“截图可供观察”的暗示。
2. screenshot 返回值应明确标注：
   - `imageDeliveredToModel`
   - `modelVisionCapable`
3. 同一页面截图未被消费时，阻止重复截图。
4. 对只需 DOM 证据的任务避免把 base64 文本放入模型上下文。

### 验收标准

- 支持视觉的模型能够引用截图中的具体 UI 事实；
- 不支持视觉的模型不会重复生成无法消费的截图；
- trace 中能区分“截图已捕获”和“模型已接收/分析”。

---

## CHR-RUN-006：发布结果缺少因果验证

严重级别：`P0`  
状态：`待处理`

### 现象

Trace 中没有出现以下任何提交动作：

- 点击已发现的“发布”按钮；
- 对“发布”按钮执行 `clickElement`；
- 按 Enter；
- 调用其他明确的 submit/publish 命令。

最后一次输入后，按钮仍为 `disabled: true`。

`tab.type()` 的当前实现只对焦点元素执行 `Input.insertText`：

- [`browser-extension/src/background/commands.ts`](../browser-extension/src/background/commands.ts)，`typeText` 附近。

它不会点击按钮、按 Enter 或提交表单。

随后 Agent 打开创作中心，发现：

```text
想法今天天天气不错 浏览 1 赞同 0 评论 0 收藏 0
```

便推断“之前的 `tab.type()` 已经成功发布”。但本次运行没有在写操作前检查创作中心基线，也没有获得新内容 ID、发布时间或提交成功事件。

### 已确认结论

Trace 能确认“创作中心显示了一条同名想法”，不能确认“该想法由本次 Agent 运行发布”。

### 可能解释

- 该想法在运行前已经存在；
- 用户或其他进程在运行期间完成了外部操作；
- 存在 trace 未覆盖的浏览器行为。

现有证据不支持判断具体是哪一种。

### 影响

- Agent 可能把外部已有状态错误归因于自身；
- 对发布、发送、删除、支付等重要动作会产生严重成功误报；
- 用户无法依据最终响应判断是否需要重新执行。

### 建议

所有外部写操作使用因果验证链：

1. 操作前记录基线；
2. 记录明确的写动作；
3. 等待动作后的确定状态变化；
4. 获取新资源 ID、时间戳或稳定的成功标志；
5. 只有 1–4 全部满足才报告“成功”。

如果只能发现同名资源，应报告：

> 找到了同名内容，但无法确认它是否由本次操作创建。

### 验收标准

- 发布前确认不存在相同测试内容，或记录已有内容 ID；
- trace 中必须出现“发布”按钮由禁用变为启用及点击事件；
- 发布后获得新增内容 ID、URL、时间戳或可靠的数量增量；
- 缺少因果证据时禁止输出确定性的成功结论。

---

## CHR-RUN-007：串行模型—工具循环造成主要耗时

严重级别：`P1`  
状态：`待处理`

### 现象

本次只有一个 user turn，却产生：

- 33 次模型调用；
- 32 次工具调用；
- 27 段用户可见进度文字；
- 大多数模型调用只生成一个工具动作。

模型独占时间约占总时长 73.6%，工具执行只占 7.4%。

最长的几个模型调用分别约为：

- 18.85 秒；
- 16.18 秒；
- 15.55 秒。

其中存在大量重复的内部讨论，例如反复重新解释：

- 编辑器可能是 `contenteditable`；
- 可以尝试 DOM、AX、selector 或坐标；
- 发布按钮仍禁用；
- 再换一个坐标或入口。

### 影响

- 每个微动作都会支付一次模型首 token 和调用间调度成本；
- 用户看到大量低价值进度文字；
- 上下文随工具输出和重复 reasoning 持续增长。

### 建议

1. 在单次 `js` 调用中完成紧密相关的原子流程：
   - snapshot；
   - 找到候选；
   - 点击/填充；
   - 检查按钮状态；
   - 返回结构化结果。
2. 仅在阶段变化、长时间等待或需要用户介入时输出进度。
3. 对重试策略使用短结构化决策，不重复复述完整背景。
4. 为常见表单操作提供高层 recipe，减少模型逐 API 编排。

### 验收标准

- 同类发布任务模型调用不超过 8 次；
- 无阻碍时总耗时目标不超过 60 秒；
- 中间用户可见进度不超过 3 段；
- 浏览器工具调用可以在一次模型决策中完成多步检查。

---

## CHR-RUN-008：模型调用间存在稳定调度间隔

严重级别：`P1`  
状态：`调查中`

### 现象

32 个相邻模型调用之间累计存在 `58933 ms` 的空档：

- 平均 `1841.7 ms`；
- 最短 `1597 ms`；
- 最长 `2748 ms`。

这些时间不属于模型 call span，也不属于工具执行。

### 待确认

- message/part 持久化耗时；
- turn state 事件广播与 UI 同步耗时；
- 下一轮 prompt 组装和序列化耗时；
- Provider 请求排队或连接建立是否被记录在 span 之外；
- trace 写入本身是否影响运行时。

### 建议

1. 在一次模型调用结束到下一次开始之间增加细分 span：
   - persist；
   - event dispatch；
   - prompt assembly；
   - provider queue；
   - network connect。
2. 复用 Provider 连接并检查是否存在固定 debounce。
3. 对连续工具循环允许无 UI 阻塞地启动下一轮。

### 验收标准

- 能解释至少 95% 的 inter-call gap；
- 平均间隔降低到 500 ms 以下，或对不可避免部分给出明确归因；
- trace 开启和关闭时的差异有基准测试覆盖。

---

## 已确认的错误调用清单

| 工具序号 | 相对时间 | 结果 |
| ---: | ---: | --- |
| 7 | +65.4 秒 | `page.click` 参数不符合 contract v1 |
| 9 | +84.7 秒 | `page.scroll` 参数不符合 contract v1 |
| 16 | +148.5 秒 | `tab.playwright.page` 为 undefined |
| 18 | +160.9 秒 | `el.boundingBox is not a function` |
| 19 | +170.8 秒 | page evaluation 被能力与权限策略禁用 |
| 20 | +178.2 秒 | `page.fill` 在 extension backend 失败 |
| 21 | +184.4 秒 | page evaluation 被能力与权限策略禁用 |
| 27 | +247.7 秒 | 猜测的 `/pin-creation` 地址返回 404 |

此外还有多次空结果、按钮继续禁用和 `success: false`。这些不一定都是 Runtime 异常，但都表示目标动作未达成。

## 修复优先级

### P0：正确性与核心能力

1. 修复或增强知乎类富文本 composer 的稳定发现和填写能力；
2. 分离工具生命周期状态与动作语义状态；
3. 为发布类外部写操作增加强制因果验证；
4. 禁止在缺少提交动作和新增资源证据时报告成功。

### P1：执行效率

1. 自动加载 Runtime Documentation；
2. 加入重复失败检测、尝试预算和停止条件；
3. 批处理紧密相关的浏览器操作；
4. 减少微步骤 progress text；
5. 定位并降低 inter-call 固定调度成本。

### P2：可观测性与资源使用

1. 明确截图是否真正交付给视觉模型；
2. 避免重复产生不可消费的大型截图；
3. 在 trace 中增加语义 outcome、stuck 状态和验证证据。

## 建议回归场景

为避免同名历史内容造成误判，回归测试应使用唯一文本，例如：

```text
anybox-chrome-runtime-e2e-<UTC timestamp>-<random suffix>
```

测试步骤：

1. 在创作中心记录测试前基线及最新想法 ID；
2. 打开知乎首页；
3. 定位并激活想法编辑器；
4. 输入唯一文本；
5. 确认“发布”按钮已启用；
6. 点击“发布”；
7. 等待明确成功状态；
8. 在创作中心验证出现新的 ID 或数量增量；
9. 保存完整 trace；
10. 测试完成后按测试策略清理内容，清理也必须单独验证。

必须断言：

- 不出现 contract mismatch；
- 不调用被策略禁用的 raw page evaluation；
- 不通过猜测 URL 绕过页面入口；
- 不超过 8 次模型调用；
- 无阻碍时不超过 60 秒；
- 最终成功结论具有发布动作和新增资源两类证据。

## 后续记录模板

```markdown
## 事件：YYYY-MM-DD <简短标题>

### 基本信息
- Session / Turn：
- 用户任务：
- 插件、Extension、Protocol、Contract 版本：
- 模型：
- 总耗时：
- 工具 / 模型调用次数：
- Trace 路径：

### 现象

### 已确认事实

### 合理推断

### 影响

### 修复建议

### 验收标准
```
