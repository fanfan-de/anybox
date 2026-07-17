# Anybox `exec` / Code Mode 架构理解提示词

> 适用场景：把本提示词交给以 `C:\Projects\Anybox` 为工作区的编码 Agent，让它先理解 Codex Code Mode `exec` 的设计，并将这种理解映射到 Anybox 当前架构。
>
> 本提示词只要求架构调研和文档沉淀，不授权实现 `exec`、安装依赖、修改业务代码或改变现有运行行为。

## 使用方法

1. 在 `C:\Projects\Anybox` 项目中启动一个新的编码任务。
2. 将下面“可直接复制的提示词”完整发送给 Agent。
3. Agent 应在完成后生成：`docs/architecture/anybox-exec-code-mode-understanding.md`。
4. 审阅这份架构认知文档后，再单独编写实现阶段提示词；不要把理解架构和正式实现合并成一次任务。

## 可直接复制的提示词

~~~text
你现在工作在 Anybox 仓库：

C:\Projects\Anybox

你的身份是一名负责 Agent Runtime、工具系统、安全隔离和跨进程协议的资深软件架构师。你的当前任务不是实现功能，而是让 Anybox 项目对 Codex Code Mode `exec` 机制形成准确、可验证、可持续维护的架构认知。

## 一、任务目标

请基于 Anybox 当前源码、项目内已有设计文档以及本机可用的 Codex 上游源码，完成以下工作：

1. 还原 Anybox 当前工具注册、模型暴露、权限审批、工具执行、结果转换、Session Runtime 和 Trace 的真实调用链。
2. 理解 Codex Code Mode `exec` 的真实架构，包括自由格式 JavaScript 输入、隔离 runtime、cell 生命周期、嵌套工具委托、`wait`、终止、输出预算、状态存储、Host IPC 和追踪模型。
3. 将 Codex 概念逐项映射到 Anybox 已有模块，明确哪些能力可以复用、哪些需要扩展、哪些必须新增。
4. 找出阻碍 Anybox 引入该机制的关键架构差距、风险、未知项和决策点。
5. 把结论沉淀为一份 Anybox 自己的架构认知文档，但不要编写或修改实现代码。

最终只允许新增或更新以下文件：

docs/architecture/anybox-exec-code-mode-understanding.md

不要修改其他文件。

## 二、首先澄清术语

本任务中的 `exec` 专指 Codex Code Mode 的 JavaScript 编排工具。它接收自由格式 JavaScript 源码，让模型在受限 runtime 中通过 `tools.<name>(...)` 组合调用已有工具。

必须明确区分以下概念：

- Code Mode `exec`：执行受限 JavaScript 编排代码。
- Code Mode `wait`：观察或终止已经 yield 的 cell。
- `tools.shell_command(...)`：由 JavaScript 反向委托给宿主执行的普通工具之一。
- Anybox 当前 shell 工具、命令执行工具或数据结构中的 `exec` 字样：它们不等于 Code Mode `exec`。
- `exec` 不是把完整 Node.js、Electron、文件系统或网络能力直接交给模型。
- `exec` 也不是简单使用 `eval()`、`new Function()` 或 `node:vm` 执行模型生成的源码。

如果发现项目中存在同名概念，必须在文档的术语表中分别命名，禁止混用。

## 三、证据优先级

所有结论必须基于证据，按以下顺序处理：

1. Anybox 当前源码是判断 Anybox 现状的唯一事实来源。
2. `docs/codex-exec-tool-design-and-implementation.md` 是本任务的主要设计导读。
3. `C:\Projects\codex` 中的当前源码用于交叉验证 Codex 的真实实现。
4. 官方 Codex 文档用于确认公开术语和产品边界。
5. 你自己的经验只能作为建议，不能冒充当前实现事实。

当设计文档、源码和你的先验知识不一致时：

- 优先相信当前源码；
- 记录差异；
- 标注“已验证事实”“基于源码的推断”或“待决策建议”；
- 不要为了形成完整故事而填补没有证据的细节。

引用实现事实时尽量给出仓库相对路径、类型或函数名。只有确认行号稳定且准确时才写行号，不要编造行号。

## 四、开始前的工作区检查

执行任何分析前：

1. 查找并完整阅读适用于目标目录的 `AGENTS.md` 或其他仓库级指令。
2. 执行只读的 `git status --short`，识别用户已有改动。
3. 保留所有既有修改，不覆盖、不格式化、不清理与本任务无关的文件。
4. 使用 `rg` 或等价工具定位源码，不要仅凭文件名猜测调用关系。
5. 不安装新依赖，不运行破坏性命令，不启动发布流程。

当前任务是架构调研。除最终架构认知文档外，所有操作都应为只读。

## 五、必读材料

先完整阅读：

- `docs/codex-exec-tool-design-and-implementation.md`

然后至少检查以下 Anybox 源码；如果文件已经移动，使用 `rg` 找到当前等价实现：

- `packages/anyboxagent/src/tool/tool.ts`
- `packages/anyboxagent/src/tool/registry.ts`
- `packages/anyboxagent/src/tool/execution.ts`
- `packages/anyboxagent/src/session/core/resolve-tools.ts`
- `packages/anyboxagent/src/permission/permission.ts`
- `packages/anyboxagent/src/tool/parallel-tool.ts`
- `packages/anyboxagent/src/tool/shell-command.ts`
- `packages/anyboxagent/src/session/runtime/`

还应通过搜索找到并检查：

- `Tool.define`、`ToolRuntime`、`ToolInfo` 和工具输出类型；
- `ToolRegistry` 的 builtin、MCP、custom tool 聚合与别名规则；
- AI SDK `ToolSet` 或 provider tools 的生成入口；
- `createToolExecution`、`needsApproval`、`Permission.evaluate` 及批准后的恢复路径；
- tool call ID、父子 call ID、Session ID、Message ID 的生成与持久化方式；
- tool result 到模型可见结果的转换逻辑；
- Session 停止、取消、恢复、流事件和 trace 的所有权；
- 只读会话、agent tool policy、全局工具选择和 MCP 权限的生效位置；
- 并行工具调用对子工具执行的复用方式。

如果 `C:\Projects\codex` 可读，请重点交叉验证：

- `codex-rs/code-mode-protocol/src/description.rs`
- `codex-rs/code-mode-protocol/src/runtime.rs`
- `codex-rs/code-mode-protocol/src/session.rs`
- `codex-rs/code-mode-protocol/src/host/`
- `codex-rs/code-mode/src/runtime/`
- `codex-rs/code-mode/src/cell_actor/`
- `codex-rs/code-mode/src/session_runtime/`
- `codex-rs/code-mode-host/src/`
- `codex-rs/core/src/tools/code_mode/`
- `codex-rs/core/src/tools/spec_plan.rs`
- `codex-rs/tools/src/code_mode.rs`
- `codex-rs/tools/src/tool_output.rs`
- `codex-rs/rollout-trace/src/code_cell.rs`

如果上游源码不可用，不要停止任务；使用项目内设计文档继续，但把未直接交叉验证的内容标记出来。

## 六、必须还原的 Anybox 当前调用链

不要只列文件。请还原并解释一条普通工具调用从模型到结果回传的真实链路，至少回答：

1. 工具从哪里注册，如何生成模型可见名称和参数 schema？
2. 哪些工具会被当前 agent、session、provider 看见？
3. 模型产生 tool call 后由哪个模块接收？
4. 参数在哪一层验证？
5. agent policy、全局选择、read-only 和 permission 分别在哪一层生效？
6. `allow`、`ask`、`deny` 分别如何推进或暂停执行？
7. 工具执行的取消信号从哪里来，传到哪里？
8. ToolRuntime 结果如何转成 AI SDK/model output？
9. tool part、session event 和 trace 如何记录状态变化？
10. `ParallelTool` 如何调用子工具，它复用了哪些宿主能力，又绕开了哪些顶层流程？

使用 Mermaid 绘制 Anybox 当前工具调用流程图。图中的每个主要节点都应能对应到实际源码模块或类型。

## 七、必须理解的目标架构

请用自己的话解释下面的目标链路，并验证它是否与 Codex 上游一致：

模型生成自由格式 JavaScript
→ `exec` 入口解析第一行 pragma 和执行预算
→ Code Mode Session 创建 cell
→ 隔离 Host/runtime 编译并执行 async JavaScript module
→ JavaScript 通过 `tools.<name>(input)` 发起嵌套调用
→ Host 通过双向协议把调用委托回 Anybox 主进程
→ Anybox 使用原 ToolRegistry、访问控制、Permission 和 ToolRuntime 执行
→ 结构化结果回到 JavaScript Promise
→ JavaScript 使用 `text`、`image`、`generatedImage`、`notify` 等产生输出
→ cell 完成、yield、失败或终止
→ `exec`/`wait` 把增量结果、状态和 trace 返回给模型与 UI

至少解释以下设计点：

### 1. 模型可见接口

- 为什么 Codex 使用自由格式 JavaScript，而不是普通 JSON 参数？
- 第一行 pragma 解决什么问题？
- Anybox 当前 provider/AI SDK 是否支持 raw/freeform tool？
- 如果暂不支持，为什么 `{ source, yieldTimeMs, maxOutputTokens }` 只能作为兼容入口，而不应形成第二套 runtime？

### 2. 工具目录

- 当前 session 中哪些工具可以进入 JavaScript `tools` 对象？
- 工具名称如何归一化并避免冲突？
- JSON Schema 如何转换成模型可理解的 TypeScript 声明？
- 为什么 `exec` 和 `wait` 不能被再次暴露给 `tools`？
- 为什么 runtime 不能根据任意字符串直接访问整个 ToolRegistry？

### 3. 隔离 runtime

- 为什么模型生成的 JavaScript 必须视为不可信代码？
- 为什么 Node `vm` 不是足够的生产安全边界？
- runtime 应明确缺少哪些能力：Node globals、模块导入、文件系统、网络、Electron bridge、桌面 IPC、动态宿主对象等？
- V8 sidecar、`isolated-vm`、QuickJS/WASM 和 worker + `vm` 的边界与工程代价分别是什么？
- CPU 无限循环、内存膨胀和大量 pending Promise 如何被限制或终止？

### 4. Cell 生命周期

- cell 的最小状态集合是什么？
- 初次 `exec` 的时间预算到期为什么是 yield，而不是取消？
- `wait` 为什么只应返回上次观察后的增量？
- 是否只允许一个活跃 observer？如何避免两个 `wait` 竞争消费输出？
- terminate 如何中断 isolate、timer、nested tool、pending approval 和通知？
- session 结束、应用退出和 Host 崩溃时，cell 由谁清理？

### 5. 嵌套工具桥

- JavaScript Promise 与主进程工具执行之间如何建立 request/response 关联？
- 嵌套调用为什么必须回到 Anybox 原有执行路径，而不是让 Host 直接 import 工具？
- nested call ID 如何关联父 `exec` call、cell ID、runtime call ID 和实际 Anybox tool call ID？
- 同一个 cell 中的 `Promise.all()` 应如何并发？并发上限属于哪一层？
- 工具返回值怎样转换成稳定、JSON 可序列化的 Code Mode result？

### 6. 权限与审批 continuation

- `allow`、`ask`、`deny` 对 JavaScript Promise 分别意味着什么？
- Anybox 当前审批为何可能绑定顶层 `Message.ToolPart`？
- nested call 遇到 `ask` 时，如何保存 continuation 并保持 cell pending/yielded？
- 用户批准后如何使用冻结的 tool、input、cwd、agent 和 policy snapshot，避免 TOCTOU？
- cell 已终止或 session 已关闭时，迟到的批准如何处理？
- 安全 MVP 为什么可以先只允许 read-only、concurrency-safe、无需询问且已经 allow 的工具？

### 7. 输出和状态

- `text`、`image`、`generatedImage` 和 `notify` 的语义有何不同？
- nested tool result、cell 累计输出和最终模型输出为什么需要不同层级的大小上限？
- 截断应在哪里发生，截断事实如何对模型和 trace 可见？
- `store/load` 的作用域、JSON 约束、总量限制和提交语义是什么？
- 普通完成、JavaScript 异常和强制终止时，stored values 是否提交？必须从上游实现中验证，不要凭直觉决定。

### 8. Host 和 IPC

- 为什么独立 Host 进程优于把 isolate 直接放在 Electron 主进程？
- 协议为什么必须支持 Host 主动请求主进程执行工具，而不是只有单向 RPC？
- execute、wait、tool request、tool response、notification、handshake 和 shutdown 分别需要哪些关联字段？
- frame 大小、活跃 cell、in-flight request、delegate 和队列为什么都要设置硬上限？
- Host 崩溃或重连后，哪些状态可以恢复，哪些必须明确丢失？

### 9. Trace 与诊断

- 为什么普通 tool trace 不足以表达 Code Mode？
- CodeCell trace 至少需要哪些 ID、状态、时间、输出预算和错误字段？
- 如何从 UI 或日志中回答“哪个 JavaScript cell 调用了哪个真实工具、为什么等待、为何被拒绝或终止”？
- Host fallback 到弱隔离、frame 超限、工具超时和批准迟到如何可观测？

## 八、Anybox 映射要求

建立一张完整映射表，每行至少包含：

- Codex 概念；
- Codex 参考类型或模块；
- Anybox 当前对应模块；
- 当前是否可直接复用；
- 所需改变；
- 风险或未知项；
- 建议落地阶段。

至少覆盖：

- Tool planning/exposure；
- freeform input 和 pragma；
- ToolDefinition/schema catalog；
- CodeModeService/Session；
- Cell actor；
- isolate/Host；
- nested delegate；
- ToolRegistry；
- access control；
- Permission/approval continuation；
- result adapter；
- output budget；
- `wait`/terminate；
- store/load；
- image/notification；
- Host IPC；
- CodeCell trace；
- provider adapter；
- UI 状态表达。

不要把“可以复用”写成笼统结论。必须说明复用的是类型、策略、执行入口、事件模型还是仅仅设计思想。

## 九、需要重点验证的初始假设

下面只是待验证假设，不是既定事实：

1. Anybox 的 `Tool.define`、ToolRegistry 和 ToolRuntime 可以作为 nested tool 的宿主基础。
2. `createToolExecution` 可以复用大部分访问控制与结果持久化逻辑，但可能需要新的 requester/context 类型。
3. 当前 `resolveTools()` 只支持 object-schema tool，需要 provider adapter 才能提供真正 freeform `exec`。
4. `ParallelTool` 提供了父子工具调用的先例，但它的安全范围和审批语义不足以直接实现 Code Mode。
5. 当前 permission resume 可能以顶层 tool part 为中心，无法直接恢复 cell 内 Promise。
6. 当前 ToolRuntime 缺少稳定的 `toCodeModeResult`，展示文本不适合作为所有嵌套结果的唯一协议。
7. 当前 Session Runtime 已拥有取消、事件和 trace 的一部分能力，但没有 cell actor 及增量观察语义。
8. 完整版本应使用独立进程中的强隔离 runtime；任何进程内弱隔离只能是显式受限模式，不能静默降级。

请逐项给出：已证实、部分证实、已否定或无法确认，并附证据。

## 十、安全不变量

在架构认知文档中单独列出并解释以下不变量。若你认为其中某项不成立，必须以源码证据说明：

1. Code Mode Host 不直接拥有 Anybox 工具实现，只能反向请求主进程。
2. nested call 必须复用当前 session 的 ToolRegistry 可见性、agent policy、全局选择、read-only 限制和 Permission。
3. 只有显式暴露给当前 cell 的工具才能通过 `tools` 调用。
4. runtime 不继承 Node、Electron、文件系统、网络或桌面 IPC 权限。
5. `exec` 和 `wait` 不允许递归自调用。
6. cell 终止后，未完成的 nested call、approval、timer、observer 和 notification 都必须取消或失效。
7. 工具结果、runtime 输出、IPC frame 和模型输出分别有硬上限。
8. stored values 按 session 隔离、只接受有界 JSON 数据，并具有明确提交语义。
9. 不能静默从强隔离降级为弱隔离执行模型源码。
10. 所有嵌套调用都能关联到父 `exec`、cell 和真实 Anybox tool call。

## 十一、禁止事项

本任务中不得：

- 实现 `exec`、`wait`、CodeModeService、Host 或 provider adapter；
- 修改 TypeScript、Rust、配置、package manifest、lockfile、测试或生成文件；
- 安装 V8、QuickJS、`isolated-vm` 或其他依赖；
- 用 `eval()`、`new Function()`、Node `vm` 写概念验证并把它描述为安全方案；
- 绕过或复制一套简化版 Permission/ToolRegistry；
- 假设所有工具都可以并行或都可以在 Code Mode 中调用；
- 把 tool 的展示文本直接等同于稳定的结构化结果协议；
- 忽略 Windows、macOS、Linux 和 Electron 打包差异；
- 清理用户工作区、回滚已有修改、提交代码或创建 PR；
- 把未验证建议写成“当前系统已经具备”。

## 十二、最终文档结构

生成 `docs/architecture/anybox-exec-code-mode-understanding.md`，至少包含以下章节：

1. 文档元数据
   - 日期；
   - Anybox commit；
   - Codex 上游 commit（若可用）；
   - 检查范围；
   - 未检查范围。

2. 执行摘要
   - 用 5 至 10 条结论说明 Anybox 当前具备什么、缺什么、最大风险是什么。

3. 术语表与概念边界
   - 明确区分 Code Mode `exec`、`wait`、shell execution、tool execution 和 Anybox 同名概念。

4. Anybox 当前工具系统
   - 关键类型和模块；
   - 当前工具调用 Mermaid 流程图；
   - 权限、取消、结果和 trace 的真实所有权。

5. Codex Code Mode 目标模型
   - 目标架构 Mermaid 图；
   - cell 状态 Mermaid state diagram；
   - 初次 execute、yield、wait、terminate 的时序；
   - nested tool 与 approval continuation 的时序。

6. Codex → Anybox 映射表
   - 按第八节要求逐项填写。

7. 已验证假设
   - 对第九节每个假设给出状态、证据和影响。

8. 架构差距清单
   - 使用 P0/P1/P2 标注；
   - 区分安全阻塞、协议阻塞、产品能力和体验增强；
   - 说明依赖关系，避免把所有差距平铺。

9. 安全模型与不变量
   - 覆盖第十节全部内容；
   - 说明信任边界和权限所有权。

10. 运行时路线比较
    - Rust sidecar + V8；
    - 独立 Node child + `isolated-vm`；
    - QuickJS/WASM；
    - worker + `vm` 的受限定位；
    - 从隔离强度、终止能力、IPC、打包、Electron ABI、跨平台和维护成本比较；
    - 给出建议，但将需要 PoC 数据的结论标为待验证。

11. 推荐的分期边界
    - A：只读 allow-only 编排 MVP；
    - B：cell、yield、wait、terminate；
    - C：完整 nested approval 与写/执行工具；
    - D：多模态和 store/load；
    - E：freeform provider、trace、限流、重连和产品化；
    - 每阶段写明进入条件、明确不包含项和验收标准。

12. 测试与验证矩阵
    - 协议；
    - 状态机；
    - 安全隔离；
    - permission；
    - cancellation；
    - 并发；
    - 输出限制；
    - Host 崩溃；
    - provider compatibility；
    - Windows/macOS/Linux 打包。

13. 待决策 ADR 清单
    - 每个 ADR 写明问题、候选项、所需证据和决策时点；
    - 不要在缺少实验数据时伪造确定结论。

14. 实现入口建议
    - 只列可能新增或修改的模块及职责；
    - 不写实现代码；
    - 标出哪些现有高风险模块不应被继续膨胀。

15. 未知项与下一步
    - 列出仍需用户、产品、provider 或 PoC 确认的事项；
    - 给出下一阶段最小提示词的目标，但不要开始实现。

16. 证据索引
    - Anybox 路径和符号；
    - Codex 上游路径和符号；
    - 对每项核心结论给出来源。

## 十三、质量门槛

完成前逐项自检：

- 文档中的 Anybox 现状都能追溯到实际源码。
- 至少包含当前架构图、目标架构图和 cell 状态图。
- 明确画出主进程、隔离 Host、runtime 和真实工具执行之间的信任边界。
- 明确说明 `exec` 为什么是编排层而不是权限层。
- 明确说明 nested approval continuation 是什么，以及为什么不能伪装成普通顶层 tool part。
- 明确说明 provider freeform 支持与 runtime 实现是两个独立问题。
- 明确说明 yield 与 timeout/cancel 的区别。
- 明确说明强制终止对 stored values、pending calls 和 trace 的影响。
- 每个 P0 差距都对应至少一个测试或 PoC 验证项。
- 所有建议都标注依据、取舍和不确定性。
- 没有修改最终架构认知文档之外的文件。
- 最终执行 Markdown 围栏、Mermaid 语法、UTF-8 和工作区差异检查。

## 十四、最终回复方式

完成后只需向用户报告：

1. 架构认知文档的路径；
2. 最重要的 3 至 5 个架构结论；
3. 最大的 P0 阻塞项；
4. 仍需用户决定的问题；
5. 明确说明本阶段没有实现功能或修改业务代码。

不要在最终回复中声称 `exec` 已经可用。
~~~

## 这份提示词解决的问题

这不是“请阅读一篇文档并总结”的普通提示词。它会迫使执行 Agent：

- 从 Anybox 当前源码重建真实调用链，而不是直接照搬 Codex；
- 把事实、推断和建议分开；
- 识别 provider 接口、隔离 runtime、权限 continuation 和产品 Trace 是四个不同层次的问题；
- 先形成项目内可维护的架构认知，再进入 PoC 或实现；
- 把安全不变量变成未来实现和评审的验收边界。

建议下一阶段在架构认知文档审阅通过后，再分别编写两个提示词：

1. “运行时路线 PoC 提示词”：只验证 V8/QuickJS/`isolated-vm` 的隔离、终止、IPC 与跨平台打包。
2. “安全编排 MVP 实现提示词”：只实现 `{ source }` 入口、只读 allow-only nested tools 和最小结构化输出。
