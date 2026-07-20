# Anybox Computer Use Windows 开发进度

> 本文档由 Codex 在开发过程中持续增量更新，作为实时进度、验证证据和未决风险的唯一跟踪入口。  
> 目标规范：[`codex-computer-use-anybox-development-report.md`](./codex-computer-use-anybox-development-report.md)  
> 当前目标：在已完成的 Windows 执行与宿主安全基础上，将模型调用面迁移为 Codex 风格的通用 Node REPL + 插件内 `sky` API（M7）。  
> 最后更新：2026-07-21 07:33 +08:00

## 当前状态

| 项目 | 状态 |
|---|---|
| 总体阶段 | M0～M7 工程实现完成；进入发布认证门 |
| 当前里程碑 | M7 已完成 |
| 当前工作 | 通用 Node REPL + 插件内 `sky` + 隐藏宿主安全能力已完成并通过本机验收 |
| 阻塞项 | Authenticode 正式签名需要发布证书；125/150/200% DPI、锁屏、device-loss 需要独立 Windows 矩阵 |
| 工作目录 | `C:\Projects\Anybox` |
| 插件目录 | `plugins/Anybox-Plugins/computer-use-windows` |

## 里程碑

- [x] M0：可重复构建与基线
  - [x] 统一 manifest、Node server、helper 与协议版本
  - [x] 新增可重复的 helper build/package/verify 脚本
  - [x] 生成并校验 helper SHA-256
  - [x] 扩充 `health_check` 版本与 capabilities
  - [x] 建立 Node/server/policy/state 基线测试
- [x] M1：状态与协议加固
  - [x] framed JSON-RPC 与 8 MiB 上限
  - [x] helper 初始化握手与稳定错误码
  - [x] state TTL 30 秒、一次性消费、同窗口 sibling state 失效
  - [x] 所有鼠标/键盘动作要求 fresh state
  - [x] helper 请求与输入动作全局串行
  - [x] timeout、abort、崩溃与重启处理
  - [x] 窗口 identity 加入 PID 创建时间与 root owner
  - [x] 完成 M1 helper/client 故障注入与真实低风险窗口验收
- [ ] M2：Windows Graphics Capture
  - [x] WGC/D3D11 成为默认窗口截图 backend
  - [x] 截图像素上限与首帧超时保护
  - [x] 双显示器与负坐标验证
  - [ ] 125%、150%、200% DPI 实机矩阵
  - [x] 遮挡窗口与最小化语义验证
  - [ ] 锁屏与设备丢失验证
- [x] M3：UI Automation
  - [x] 有界 UIA snapshot 与敏感字段过滤
  - [x] element revision 与一次性元素动作
  - [x] `click(elementIndex)`、`set_value`、`perform_secondary_action`
  - [x] UIA pattern 优先、坐标动作回退
- [x] M4：应用目录与安全策略
  - [x] Win32/AUMID app catalog 与受限 `launch_app`
  - [x] identity、integrity、foreground、point ownership 校验
  - [x] physical input epoch 与安全剪贴板事务
  - [x] 终端、Anybox、安全/凭据/高权限目标硬拒绝
- [x] M5：Anybox 宿主 broker
  - [x] `anybox.computer-use` 内建 MCP 与受信任 helper 生命周期
  - [x] named pipe ACL、随机名、一次性 token、turn lease
  - [x] app once/session/always approval 与撤销
  - [x] 显式 `computer.use.*` 事件、Desktop overlay 与物理 Esc 熔断
  - [x] 插件切换为 `mcpRequirements`
- [x] M6：动态审批与发布加固（工程实现）
  - [x] 参数敏感的可信 permission advisor
  - [x] admin deny policy
  - [x] helper 启动时哈希校验与 packaged runtime 签名强制门
  - [x] CycloneDX SBOM、in-toto/SLSA provenance 与全文件哈希
  - [ ] Authenticode 正式签名
  - [x] 隐私安全遥测与 helper crash recovery
  - [x] 安装/诊断/选择/卸载 E2E 与升级/降级测试
  - [ ] clean checkout 发布复现与剩余 Windows 实机矩阵
- [x] M7：Codex Node REPL 调用面对齐
  - [x] 为通用 Node REPL 增加单次、受限、不可伪造的插件能力桥接
  - [x] 在插件内实现 `sky` 风格 API、状态映射、截图回传与动作封装
  - [x] 插件同时声明通用 Node REPL 与隐藏 Computer Use 宿主能力依赖
  - [x] 从模型工具列表隐藏 14 个底层 Computer Use MCP 工具
  - [x] 将动作审批迁到受信任宿主调用边界，保持每动作一次审批
  - [x] 完成安全回归、插件测试、packaged runtime 与真实 Windows smoke

## 增量日志

### 2026-07-21 03:21 +08:00 — 启动

- 已读取并接受目标开发报告的 M0～M6 路线与两阶段架构。
- 已读取 `anybox-plugin` 规范、manifest、MCP 和分发验证参考。
- 已读取 Windows `computer-use` 技能，确认目标能力应采用窗口级截图、UI Automation 与受控输入，而不是仅依赖全屏坐标。
- 已确认当前插件根目录和规范 manifest 已存在。
- 已确认 Git 工作区启动时无未提交改动。
- 下一步：按仓库实时解析器、测试、现有插件 manifest/server/helper 的顺序完成基线审计。

### 2026-07-21 03:31 +08:00 — 基线审计完成

- 实时解析器确认：
  - manifest 查找顺序仍为 `.anybox-plugin/plugin.json`、根 `plugin.json`、`.codex-plugin/plugin.json`；
  - manifest 为 strict schema，当前插件字段合法；
  - `risk: "high"` 可安装，`critical` 会被拒绝；
  - 当前插件生成的 MCP ID 与 Skill ID 分别为 `plugin.computer-use-windows.windows`、`plugin:computer-use-windows:computer-use`。
- 当前实现确认：
  - manifest/Node 源码版本为 `0.1.1`，包内 helper 实际健康检查仍报告 `0.1.0`；
  - Node/helper 使用逐行 JSON，缺少 frame 上限、握手、稳定错误码和取消；
  - `windowRef` 主要绑定 `HWND`，`snapshotRef` TTL 为 10 分钟且可重复使用；
  - `press_key`、`type_text` 不需要 snapshot/state；
  - helper 使用 `Graphics.CopyFromScreen`，没有 WGC 与 UIA；
  - helper 忽略 `SetForegroundWindow` 结果，尚未执行 PID 创建时间、root owner、integrity、point ownership 与用户输入 epoch 校验。
- 环境确认：
  - .NET SDK `9.0.304`、Node `22.19.0`、Bun `1.3.6` 可用；
  - 本机已有 Windows SDK .NET 引用包，可支持后续 WGC/WinRT 构建验证。
- 决定：M0/M1 先拆出 Node 协议、状态、策略和 helper client 模块；helper 同步迁移到 4 字节 little-endian framed JSON-RPC，避免先写一套临时协议再返工。

### 2026-07-21 03:34 +08:00 — M0 完成，M1 主路径落地

- 版本统一为插件/helper `0.2.0`、helper protocol `1`。
- 新增 `package-helper.ps1` 与 `verify-package.mjs`：
  - 从源码 self-contained/single-file publish；
  - 自动替换包内 helper；
  - 自动生成并验证 SHA-256；
  - 启动真实 helper，验证 framed handshake 与 health。
- 当前包内 helper SHA-256：
  - `a19c44495c1c3500b73007f2083077d3d1bfae2bff8d991ea466fa697819196f`
- Node MCP server 已模块化为 build info、错误、frame codec、helper client、policy、state registry、window registry、serial queue 与 tool definitions。
- helper 已拆分为 Protocol、Windows、Capture、Input、Policy 模块。
- M1 已实现：
  - 4 字节 little-endian frame 与 8 MiB 上限；
  - JSON-RPC initialize/capability handshake；
  - 30 秒 `stateRef`、一次动作即消费、sibling state 失效；
  - `press_key`/`type_text` 也必须使用 fresh state；
  - PID 创建时间、root owner、exe identity、session 组成的窗口 identity；
  - Node 与 helper 双层窗口/状态校验；
  - helper/client 串行、deadline、abort、timeout、崩溃重启；
  - `dwExtraInfo` 合成输入 marker、按键/鼠标 `finally` 释放；
  - 前台与点位归属基础校验；
  - 剪贴板 sequence-aware 恢复。
- 首轮 Node 测试 14 项中 13 项通过，1 项因测试夹具错误失败；修正夹具后 14/14 通过。

### 2026-07-21 03:36 +08:00 — M1 完成

- 增加真实 helper 协议集成测试：
  - frame 拆成多个 chunk；
  - 一个 chunk 包含多个 frame；
  - 不兼容 protocol version；
  - 超过 8 MiB 的 frame；
  - 未知 helper method。
- 增加 helper client 故障注入：
  - 并发请求按顺序执行；
  - helper 超时后被终止，并在下一请求重新握手；
  - in-flight action abort 返回 `CU_INTERRUPTED` 和 `effectMayHaveOccurred: true`。
- 增加动作失败状态测试：helper 注入失败后，相同 `stateRef` 返回 `CU_STATE_CONSUMED`。
- 对真实桌面执行只读 `list_windows`：
  - 解析到 13 个窗口，其中 2 个被安全策略标记为 blocked；
  - public MCP 输出未泄露 PID、native identity 或 executable identity；
  - 本项没有截图，也没有发送鼠标/键盘输入。
- 包内 helper 重建后的 SHA-256：
  - `83eae2e36a5244005b12912f131ae25589d5652906157014e497f0af08567e54`

### 2026-07-21 03:42 +08:00 — M2 WGC 主路径编译并打包

- helper 目标框架升级为 `net9.0-windows10.0.19041.0`，使用 Windows SDK WinRT 投影。
- 新增 Windows Graphics Capture 后端：
  - 通过 `IGraphicsCaptureItemInterop::CreateForWindow` 直接绑定目标 `HWND`；
  - 使用 D3D11 BGRA 设备与 `CreateFreeThreaded` frame pool；
  - 首帧超时为 10 秒，截图像素上限为 1600 万；
  - 禁用截图中的鼠标指针；
  - 通过 `SoftwareBitmap`/`BitmapEncoder` 编码 PNG。
- WGC 已成为 `get_window_state` 的默认截图路径，旧的 `CopyFromScreen` 不再参与默认捕获。
- `dotnet build` 通过，0 warning / 0 error；打包后的真实 helper 握手报告：
  - `captureBackend: windows-graphics-capture`
  - `captureWgc: true`
- 当前包内 helper SHA-256：
  - `1bf70a252f5b2dda35cbadc8804954f1c4a263839a06e64ab63b79a26ef29e2e`
- 下一步：修正首帧竞态与 framed JSON 的 base64 容量边界，并使用专用测试窗口完成遮挡、最小化和尺寸验收，不读取普通用户窗口。

### 2026-07-21 03:46 +08:00 — M2 受控窗口首轮验收通过

- 修正 WGC 首帧事件竞态：首帧完成后到达的额外 frame 会立即释放。
- 修正 8 MiB frame 容量计算：PNG 上限已预留 JSON envelope，并计入 base64 的 4/3 膨胀。
- 新增专用 WinForms 测试夹具，包含固定颜色区域、普通文本框、密码框、按钮、复选框和状态标签；同一夹具将用于后续 UIA 与输入验收。
- 新增 `smoke-wgc.mjs`，验收过程只操作标题精确匹配的测试夹具：
  - 无遮挡截图尺寸为 722×472；
  - 蓝色标记像素 83,566、青色标记像素 55,410；
  - 在同尺寸、TopMost 洋红色窗口完全遮挡目标后，目标截图中的两类标记像素数量保持完全一致；
  - 遮挡窗口的洋红色像素在目标截图中为 0；
  - 目标最小化后截图稳定返回 `CU_WINDOW_CHANGED`，并要求 fresh state。
- 初次 smoke 因测试进程带 `windowsHide` 导致夹具不可见而未被枚举；去掉该测试启动标志后通过。该失败发生在窗口枚举前，没有截图普通窗口，也没有输入动作。
- 当前包内 helper SHA-256：
  - `d728bf05da5cb5b62568b2edef0d814d9cd7f436ae79d1025c3e11b6807bb1d0`

### 2026-07-21 04:07 +08:00 — M2 多显示器补充验收、M3 完成

- WGC 在第二块显示器的负坐标窗口上完成验收：
  - 窗口坐标 `x=-2293, y=160`；
  - 截图仍为 722×472；
  - 蓝色/青色固定标记像素与主显示器完全一致；
  - 当前两块实机显示器均为 100% DPI，125%/150%/200% 仍保留为后续实机矩阵。
- UIA 运行时最初使用旧 `System.Windows.Automation`，真实 self-contained 包暴露 `PresentationNative` 兼容问题；已改为 `CUIAutomation8`/UIA3 COM 互操作，并设置 connection/transaction timeout，去掉旧 WPF UIAutomation 依赖。
- M3 已实现：
  - Control View 有界遍历：最大深度 32、最多 2,000 节点、tree 最大 256 KiB；
  - 单属性最大 4 KiB、按需 document text 最大 64 KiB；
  - `RuntimeId`、role/name、automation ID、class/framework、bounds、pattern、value 与控件状态快照；
  - password 元素只报告 `password` 标志，绝不读取或返回 Value/Text；
  - focused/selected/toggle/expand-collapse state 与 allowlisted secondary action；
  - helper 原生 30 秒一次性 `nativeStateRef`，动作失败也不可复用；
  - 动作前重新生成 UIA fingerprint，窗口内容变化时返回 `CU_UIA_STALE`；
  - `InvokePattern` 元素点击、`ValuePattern`/`RangeValuePattern` 赋值、Toggle/Select/Expand/Collapse；
  - pattern 不可用时，元素点击/滚动回退到复核后的中心点坐标。
- 受控 UIA smoke 通过：
  - 标准夹具获得 20 个语义节点、tree 1,571 字符；
  - `InvokePattern` 将计数器从 0 更新到 1；
  - `ValuePattern` 将普通文本框更新为 `uia-updated`；
  - checkbox toggle 前后分别报告 `unchecked`/`checked`；
  - 密码原值与测试注入值均未返回，向密码控件 `set_value` 返回 `CU_APP_BLOCKED`；
  - 同一个 native state 二次动作返回 `CU_STATE_CONSUMED`；
  - 错误 revision 与观察后异步变化的 UI tree 均返回 `CU_UIA_STALE`；
  - 2,100 控件压力夹具在 2,000 节点、136,460 字符处设置 `truncated: true`，未继续无界遍历。
- Node/MCP 工具契约新增元素模式的 `click`/`scroll`、`set_value`、`perform_secondary_action`；manifest 与所有输入工具 `ask` policy 已同步。
- 当前包内 helper SHA-256：
  - `4a5b5b28aac209bc97d40c433d238b65a9aa2d949d3297c69ea8202a51d09ecf`

### 2026-07-21 04:19 +08:00 — M4 实现完成，开始完整回归

- 新增只读应用目录与受限启动：
  - 聚合当前运行应用、Win32 App Paths 与 MSIX/AppX AUMID；
  - 对外仅返回稳定 app ID、显示名、类别与运行状态，不暴露路径、命令行或 AUMID；
  - `catalogRef` 有效期 2 分钟；启动只接受当前目录中的 opaque app selector；
  - Win32 启动前重新校验文件 identity，MSIX 使用 `IApplicationActivationManager`；
  - Node 与 helper 双层拒绝路径、任意命令和额外启动参数。
- 新增进程 integrity 检查：窗口 identity 绑定目标 token integrity，未知或高于 helper 的目标返回 `CU_HIGHER_INTEGRITY_TARGET`。
- 新增活动桌面守卫：锁屏、非 input desktop 或无法切换桌面时，观察与动作返回 `CU_DESKTOP_LOCKED`。
- 新增低级键盘/鼠标物理输入监控：
  - 合成输入携带随机 marker，不增加 physical input epoch；
  - 用户或外部进程输入会推进 epoch，使旧 state 返回 `CU_USER_INPUT_DETECTED`；
  - 指针移动改为带 marker 的 `SendInput` virtual-desktop 坐标，覆盖负坐标显示器。
- 安全策略在 Node/helper 双层硬拒绝 helper 自身、Anybox、终端、凭据/安全界面、密码管理器与 agent UI；密码控件禁止键入。
- 剪贴板输入已实现 sequence-aware 事务：只有剪贴板仍是 helper 临时值时才恢复旧值，不覆盖并发用户/应用写入。
- 重新打包与严格契约验证通过：
  - 插件/helper `0.2.0`、protocol `1`；
  - WGC、UIA、元素动作、physical input epoch、应用目录与应用启动能力均已握手确认；
  - 当前包内 helper SHA-256：`648cd51dfee25256af3047a501b7bbef34fd6a06f74eb77a5ca3a51597c1b6e9`。
- 使用显式测试文件列表运行，23/23 项通过；已避免 PowerShell 不展开 Node glob 时可能出现的“0 项测试”假阳性。
- 下一步：依次执行 WGC、UIA、应用目录和安全策略四组真实 Windows 冒烟测试。

### 2026-07-21 04:20 +08:00 — M4 完整回归进行中

- WGC 真实冒烟通过：
  - 无遮挡与完全遮挡截图均为 722×472；
  - 两组目标颜色像素分别始终为 83,566 与 55,410，遮挡窗口像素始终为 0；
  - 最小化窗口返回 `CU_WINDOW_CHANGED`；
  - 负坐标副屏窗口位于 `(-2293, 160)`，捕获尺寸和像素计数保持一致。
- UIA 真实冒烟通过：
  - 标准夹具返回 20 个节点、1,571 字符；
  - 密码值过滤、document text 限额、Invoke/Value/Toggle pattern 均通过；
  - native state 一次性消费、错误 revision 与异步 tree mutation 均被拒绝；
  - 2,100 控件夹具在 2,000 节点、136,460 字符处正确截断。
- 应用目录与受限启动真实冒烟通过：
  - 枚举到 301 个应用，其中 250 个 MSIX/AppX 应用、10 个命中 blocked 类别；
  - 跨两次目录扫描的稳定 app ID 一致；
  - 任意路径/伪造启动被拒绝；
  - 仅通过当前 catalog selector 启动专用测试夹具，并在测试后清理。
- 首次安全策略回归在“目标点被 TopMost 测试窗口覆盖后，点击必须返回 `CU_POINT_OUTSIDE_TARGET`”断言处失败：调用未返回错误。
  - 精确失败位置为 `smoke-safety.mjs:205`；focused-password 检查已存在，尚未执行到后续密码键入断言；
  - 诊断确认目标点 `(607,416)` 位于遮挡窗口 `(120,120,736×479)` 内，helper 拒绝路径有效，问题是夹具刚显示时的 TopMost z-order 稳定竞态；
  - 测试现在等待 750 ms，并在发送动作前断言遮挡窗口几何上覆盖目标点，避免偶发假失败。
- 安全策略真实冒烟随后连续 3 次通过：
  - 外部低级鼠标事件使 physical input epoch 从 0 增至 2，旧 state 返回 `CU_USER_INPUT_DETECTED`；
  - helper 与测试目标均识别为 medium integrity；
  - 遮挡点返回 `CU_POINT_OUTSIDE_TARGET`，同一 state 再用返回 `CU_STATE_CONSUMED`；
  - 坐标点击回退真实更新控件，helper 合成输入不增加 epoch；
  - 聚焦密码框后的 `type_text` 返回 `CU_APP_BLOCKED`；
  - 夹具并发改写剪贴板时 helper 不覆盖新值，夹具随后恢复测试前原值。
- M4 完成；插件增强版 v0.2 的 M0、M1、M3、M4 已完成，M2 仅保留额外 DPI/锁屏/device-loss 实机矩阵。
- 下一步进入 M5：实现 Anybox 宿主侧可信 broker、turn lease、approval、事件与 Desktop overlay。

### 2026-07-21 04:41 +08:00 — M5 宿主集成架构审计完成

- 已确认采用 Anybox Agent 进程内的可信 MCP facade，而不是继续让插件进程直接持有 helper：
  - canonical definition/server 分别为 `computer-use` / `anybox.computer-use`；
  - 插件仅声明 `mcpRequirements`，第三方插件拿不到 broker/helper 传输凭据；
  - 复用经过 M0–M4 验证的 `ComputerUseServer` 工具契约，但由宿主打包并注入受控 helper 接口。
- helper 传输边界确定为 Windows named pipe：
  - 每次启动生成随机 128-bit pipe 名称；
  - `PipeOptions.CurrentUserOnly`、单实例、单客户端；
  - 一次性 challenge token 只经 stdin 传递，不进入命令行、环境变量、磁盘或日志；
  - helper 校验连接方 PID 与 broker PID，并校验自身 parent PID；
  - pipe 断开即退出，输出写入串行化，避免响应与物理 Esc notification 帧交错。
- 全局 turn lease 与中断语义已确定：
  - 首个受控观察/动作获取 lease，同一 turn 续租，不同 turn 返回 `CU_BUSY`；
  - lease 绑定 session/turn/toolCall 元数据，终态事件释放；
  - 物理 Esc 由低级键盘 hook 直接通知 broker，broker 熔断 helper、标记 `CU_INTERRUPTED` 并取消 turn；
  -显式运行时事件为 `computer.use.started`、`computer.use.app_changed`、`computer.use.interrupted`、`computer.use.stopped`。
- 应用授权复用 Agent 现有 Permission 基础设施，新增 `computer-use-app` scope：
  - 支持 once/session/always/deny；
  - always 决策持久化到 Agent SQLite，并在 Settings 中可查看与撤销；
  - `full_access` 不绕过 Computer Use 应用授权。
- Desktop overlay 将优先消费显式事件，不再依赖 MCP 工具名前缀；Esc 先中断 broker，再执行现有 turn cancel。
- 下一步：先实现 helper named-pipe/物理 Esc 协议，再接入 Agent broker 与内置 MCP。

### 2026-07-21 04:56 +08:00 — M5 helper broker transport 与 Agent lease 已落地

- 原生 helper 新增宿主 broker 模式，同时保留阶段 A stdio 兼容模式：
  - named pipe 使用 `CurrentUserOnly`、单实例和单客户端；
  - 启动参数只含随机 pipe 名和 broker PID，一次性 256-bit token 仅经 stdin 传入；
  - helper 校验自身 parent PID 以及 named-pipe 客户端 PID；
  - initialize 使用 fixed-time token 比较并立即清零 token byte buffer；
  - broker 模式下所有业务请求强制携带 session/turn/toolCall 元数据；
  - pipe 断开即终止 helper；frame 写入加锁，允许安全发送异步 notification。
- 低级键盘 hook 已识别非合成的物理 Esc keydown：
  - 仅 broker 模式发送 `physical_escape` notification；
  - 阶段 A stdio 不发送无 ID 帧，因此不破坏旧 HelperClient 契约。
- helper 新增 `end_turn` 清理入口，握手/health 中 `hostBroker` 与 `physicalEscape` 已按模式准确报告。
- Agent 新增：
  - 私有 named-pipe helper transport（8 MiB frame、deadline、abort/timeout 熔断）；
  - 全局 turn lease（同 turn 续租、跨 turn `CU_BUSY`、中断后保持 `CU_INTERRUPTED` 直到终态）；
  - host-owned broker、AsyncLocalStorage 请求身份绑定、10 分钟失联 watchdog；
  - canonical `computer-use` / `anybox.computer-use` 内置 MCP 定义；
  - 进程内 `ComputerUseFacadeClient`，插件业务工具契约由宿主加载并注入 broker helper；
  - 四类显式 runtime event schema 与 emit 路径。
- 验证：
  - helper Release build：0 warning / 0 error；
  - 重新打包成功，SHA-256 更新为 `4491114626d8eb6b03483f6e0e5477474cfc4d4c4593d704fd0127134d847b17`；
  - 真实 Agent → helper 私有管道握手与 health call 通过，确认 `hostBroker=true`、`physicalEscape=true`；
  - turn lease 单测覆盖续租、跨 turn 排斥、中断熔断和释放，2/2 tests、10 assertions 通过；
  - 新增 Agent MCP/runtime event 代码无 TypeScript 错误；全仓 typecheck 仍只有 3 个任务开始前已存在的 Test 类型错误。
- 下一步：补齐 app approval 持久策略和撤销 API，再接 Desktop 显式 overlay 事件与 Esc 中断路由。

### 2026-07-21 05:12 +08:00 — M5 完成，M6 动态审批与完整性门落地

- M5 宿主可信版闭环已经完成：
  - app once/session/always/deny 通过 Agent Permission 流程，persistent allow 写入 SQLite，并可在 Desktop Settings 查看和撤销；
  - `full_access` 不绕过应用授权；应用授权也不绕过每个输入动作的审批；
  - Desktop 消费显式 `computer.use.*` 事件，显示应用变化，Esc 先熔断 broker/helper 再取消 turn；
  - 打包后的 Agent runtime 已包含宿主 facade、14 个工具与 Windows helper，独立 runtime 验证和 facade smoke 均通过；
  - 真实 named-pipe 测试确认合法 broker 握手成功、其他 PID 的客户端被 helper 拒绝。
- M6 新增 Anybox-owned permission advisor：
  - 5 个只读观察工具为 low/allow，但应用访问仍由 broker 单独审批；
  - 所有输入/启动动作强制 `ask`，即使用户处于 `full_access` 或应用已 always allow；
  - `auth_or_secret`、`finance`、`security_settings` 为 critical/deny；
  - `delete/send/upload/install` 等 safety 或中英文 purpose 即使声明 `normal` 也提升到 high/ask；
  - `type_text` 审批描述只显示字符数，输入原文不会进入 approval body。
- 新增宿主管理员策略：
  - `ANYBOX_COMPUTER_USE_DISABLED` 可全局禁用；
  - `ANYBOX_COMPUTER_USE_DENY_APP_IDS` 可按稳定 app ID 精确禁用或使用 `*` 全禁用；
  - 管理员 deny 在 persistent user allow 之前执行，用户无法从 Settings 撤销或绕过。
- Agent 启动 helper 前现在强制读取同目录 SHA-256 manifest 并重新计算 EXE 摘要；manifest 缺失或 helper 被替换时均在 spawn 前拒绝。
- 新增/扩展三组安全回归：permission advisor、admin/persistent app policy、host broker/integrity；14/14 tests、44 assertions 通过，其中包含真实 helper pipe 握手、rogue PID 与被替换 helper。
- 下一步：只记录不可逆摘要的安全遥测、helper crash/restart 故障注入、CycloneDX SBOM/in-toto provenance，以及 Authenticode release-strict gate。

### 2026-07-21 05:14 +08:00 — M6 隐私安全遥测与 crash recovery 完成

- 新增专用 `computer-use.security` 结构化遥测，字段被固定白名单约束：
  - session、turn、tool call、app、windowRef 和 stateRef 使用每进程随机密钥的 HMAC-SHA256 短摘要；
  - 仅记录工具/协议操作名、耗时、稳定结果码、helper 版本和 `effectMayHaveOccurred`；
  - 不向遥测函数传入 screenshot、UIA tree、窗口标题、type/set 原文、剪贴板、URL 或路径。
- 遥测标签还会经过长度/字符集限制，无法把带空格或换行的任意模型文本伪装成工具名/结果码写入日志。
- helper transport 的失败清理已加强：
  - 任意启动/握手失败统一关闭 pipe、终止子进程、清空 partial frame、版本状态和 pending requests；
  - broker pipe 意外断开时主动终止 helper；
  - 下一次请求重新执行摘要校验、生成新 pipe/token 并完成新握手。
- 新增真实 crash/restart 故障注入：破坏活动 pipe 后确认旧 helper 退出，随后同一 transport 以不同 PID 重新启动并握手成功。
- 遥测隐私与 crash recovery 回归合计 10/10 tests、34 assertions 通过；此前动态审批/admin/integrity 回归仍保持通过。
- 下一步：在 Agent runtime 构建中生成并验证 Computer Use CycloneDX SBOM 和 in-toto/SLSA 风格 provenance，加入未签名 helper 的 release-strict 阻断门。

### 2026-07-21 05:25 +08:00 — M6 supply-chain metadata、发布门与宿主 E2E 完成

- Agent runtime 构建现在为 Computer Use 生成三份发布元数据：
  - `computer-use/manifest.json`：组件/helper/protocol/platform/arch、Authenticode 状态与 15 个宿主 bundle/facade/helper 文件的 size + SHA-256；
  - `computer-use/sbom.cdx.json`：CycloneDX 1.5，包含宿主运行组件、.NET/UIAutomation 依赖与每个交付文件摘要；
  - `computer-use/provenance.intoto.json`：in-toto Statement v1 + SLSA provenance v1，绑定 builder、源码 revision/dirty 状态、源码 materials 和全部交付 subjects。
- verifier 会逐文件复算大小和 SHA-256，并要求 manifest、SBOM、provenance 三者的文件集合及摘要完全一致；篡改 facade 后稳定失败。
- Authenticode 状态通过独立 PowerShell 进程读取：
  - 普通开发验证当前报告 `NotSigned`，仍由 helper SHA-256 门保护；
  - `verify-agent-runtime.mjs --release-strict` 要求状态必须为 `Valid`；
  - 当前未签名 helper 的 release-strict 拒绝路径已实测，错误明确指向 Authenticode gate。
- 使用最新 Agent 源码重建独立 runtime 成功，输出位于 `packages/desktop/build/agent-runtime-computer-use-final`：
  - runtime 普通验证通过，Computer Use 15 个 artifact、媒体/工作区依赖同时通过；
  - 打包 Agent 启动 smoke 通过，注册 owner 为 `{kind: "anybox", bindingID: "computer-use"}` 的 `anybox.computer-use`，列出完整 14 工具；
  - smoke 脚本已同步支持 `ANYBOX_AGENT_RUNTIME_OUTPUT_DIR`，避免验证错误目录。
- 宿主 E2E 新覆盖实际 `computer-use-windows` catalog → install → project selection → 14-tool diagnostic → uninstall；卸载插件后宿主 MCP 保留。
- 独立 upgrade/downgrade fixture 验证 `mcpRequirements` 在 `0.2.0 → 0.2.1 → 0.1.9` 中保持 `anybox.computer-use`，用户禁用的 `click` 策略不被升级或降级覆盖。
- Agent 整组相关回归：78/78 tests、719 assertions 通过；supply-chain 生成/验证/篡改/未签名发布阻断：2/2 tests 通过。
- 当前唯一发布凭据阻塞：仓库没有可用的 Authenticode 代码签名证书；严格发布门已就位，拿到证书并在 `package-helper.ps1` 的哈希生成前签名即可通过。
- 下一步：回归 Desktop UI/typecheck、插件 23 项与四组真实 Windows smoke，补齐锁屏/device-loss/DPI 能在当前硬件完成的矩阵，并整理最终验收差距。

### 2026-07-21 05:38 +08:00 — packaged runtime Authenticode 强制门完成

- helper 的运行时信任链从“仅校验同目录 SHA-256”增强为：
  1. 启动前复算 EXE SHA-256 并匹配 integrity manifest；
  2. 当 `ANYBOX_COMPUTER_USE_REQUIRE_SIGNATURE=1` 时，通过隔离 PowerShell 进程读取 Authenticode，只有 `Valid` 才允许 spawn；
  3. Windows 正式打包的 Desktop 会强制向托管 Agent 注入该开关，继承环境中的 `0` 无法降低正式版要求；源码开发版默认不启用，仍可测试当前未签名 helper。
- 新增“摘要正确但未签名”的 helper fixture，确认严格门在 spawn 前返回稳定 `CU_PROTOCOL_MISMATCH`；真实未签名开发 helper 的普通 named-pipe 流程仍正常。
- permission advisor 同时完成最后一项收口：用户已配置的 MCP `disabled` 或 `ask` 策略不会被 Computer Use advisor 放宽，advisor 只允许进一步收紧动作审批。
- 针对性回归：
  - Agent broker/pipe/integrity/signature/facade：9/9 tests、22 assertions 通过；
  - Desktop managed Agent launch env：10/10 tests 通过。
- 下一步：执行 Agent、Desktop、插件、supply-chain 与真实 Windows smoke 的最终全量回归，并把无法在当前单机环境自动覆盖的 DPI/锁屏/device-loss 明确留作发布硬件矩阵。

### 2026-07-21 05:44 +08:00 — M0～M6 工程实现与最终本机验收完成

- 修复最终回归发现的测试竞态：rogue-PID 故障注入现在会在有界截止时间内等待 named pipe 建立，并在所有路径清理 helper/rogue 子进程；该测试连续 3/3 轮通过。
- 最终自动化回归：
  - Agent 权限、插件生命周期、host broker、admin policy、permission advisor、telemetry：80/80 tests、723 assertions；
  - Desktop managed launch、overlay、Settings：22/22 tests；
  - 插件 framed protocol/policy/state/client：23/23 tests；
  - supply-chain 生成、交叉摘要、篡改检测、未签名 strict-release 阻断：2/2 tests；
  - Desktop TypeScript typecheck 与 `git diff --check` 通过；
  - Agent TypeScript 全项目检查仍只有 3 个开发前已存在的测试类型错误（Cinema summary 2 个、server fixture 1 个），Computer Use 源码无新增错误。
- 使用最新源码重新生成独立 runtime `packages/desktop/build/agent-runtime-computer-use-final`：
  - 15 个 Computer Use artifact 摘要、SBOM、provenance 普通验证通过，状态为 `Authenticode=NotSigned`；
  - bundle 内确认包含 `ANYBOX_COMPUTER_USE_REQUIRE_SIGNATURE` 和 publisher signature rejection；
  - packaged Agent 启动、Anybox-owned MCP ownership、14 个工具诊断全部通过；
  - `--release-strict` 对当前未签名 helper 按预期失败。
- 最终真实 Windows 回归：
  - helper Release build：0 warning / 0 error；
  - package verify：插件/helper `0.2.0`、protocol `1`、WGC/UIA/physical epoch 正常、SHA-256 `4491114626d8eb6b03483f6e0e5477474cfc4d4c4593d704fd0127134d847b17`；
  - WGC：遮挡前后像素一致、最小化返回 `CU_WINDOW_CHANGED`、负坐标显示器 `x=-2293`；
  - UIA：20 个初始节点、密码值过滤、Invoke/Value/Toggle、一次性 state、stale/tree mutation、2,000 节点上限全部通过；
  - app catalog：302 个应用、250 个 packaged app、10 个阻止项、稳定 ID、任意路径拒绝与受控启动通过；
  - safety：physical input epoch、integrity、point ownership、坐标回退、synthetic input、密码键入拒绝、剪贴板并发/恢复全部通过。
- 未发现 Computer Use 源码中的 TODO、stub 或 `NotImplemented` 路径。
- README、安全说明与发布流程已同步运行时双重校验行为；Desktop 回归还显式验证 packaged 环境会把继承的签名开关 `0` 覆盖为 `1`。
- 工程目标已完成；正式发布仍需在签名后重新生成哈希和供应链元数据，并在干净提交上执行 release-strict/clean-checkout 复现。当前机器为 100% DPI，且不应在活跃开发会话中自动锁屏或注入 device loss，因此这些项目保留为明确的发布硬件认证门。

### 2026-07-21 07:03 +08:00 — M7 启动：调用面改为通用 Node REPL + 插件 API

- 复核 Codex 当前 Computer Use 插件后确认：模型侧入口是持久 Node REPL 中加载插件脚本并使用 `sky` API；Computer Use server/host 仍存在，但底层工具不直接暴露给模型。
- Anybox 现状的 14 个专用 MCP 工具来自原开发报告“保留 MCP facade”的建议，功能与安全链已经完成，但模型调用面没有对齐 Codex。
- 用户进一步确认架构边界：Anybox 内建 Node REPL 必须保持通用，Computer Use 业务逻辑必须位于插件。
- M7 采用以下职责划分：
  - 内建 Node REPL 仅新增通用的受限插件能力桥接，不包含 Computer Use 名称、方法、窗口状态或动作语义；
  - `computer-use-windows` 插件负责 `sky` 包装层、API 映射、截图发射、状态缓存、动作参数和使用文档；
  - 宿主只保留能力授权、动态审批、turn lease、helper 完整性/签名校验、管道隔离与物理 Esc 等可信安全职责。
- 桥接将使用每次 `js` 调用随机生成且绑定 session/turn/message/toolCall 的短生命周期 capability；能力不会暴露 helper pipe/token，调用结束立即失效。
- 下一步：先实现通用桥接与宿主权限回调，再迁移插件 `sky` API 和清单，最后验证模型工具面只保留 Node REPL。

### 2026-07-21 07:12 +08:00 — 通用桥接与插件内 `sky` API 完成

- 内建 Node REPL 新增中性的 `nodeRepl.callPluginCapability(capability, operation, args)`：
  - 不包含任何 Computer Use 方法名、窗口/截图/点击语义或 helper 协议；
  - 每次 `js` 调用使用 256-bit 随机 grant，绑定 session/turn/message/toolCall；
  - grant 不出现在公开 `requestMeta`，外层 `js` 返回后立即销毁；
  - 每个 `js` 调用最多领取一个通用“状态变更”槽，允许动作后继续只读刷新；
  - 宿主等待审批/能力调用的时间不计入 JavaScript 执行超时。
- Node REPL 定向测试扩为 9/9：覆盖无上下文拒绝、grant 生命周期、上下文绑定、一动作上限、持久状态、图片/权限基础能力。
- 内建 MCP 定义新增通用 `modelExposure: "plugin-capability"`；`anybox.computer-use` 仍可诊断和配置，但其 14 个底层工具会从模型工具发现面隐藏。
- 插件新增 `scripts/computer-use-client.mjs`，所有 Computer Use 调用面业务均位于插件：
  - `sky.list_apps/list_windows/get_window/launch_app/get_window_state`；
  - `click/press_key/type_text/scroll/set_value/drag/perform_secondary_action/activate_window`；
  - 数字 Window ID ↔ opaque `windowRef`、最新 state/screenshot 缓存、snake_case API 映射；
  - 截图通过通用 `nodeRepl.emitImage` 回传，内部 `stateRef/windowRef` 不暴露给模型；
  - turn/session/reset 时清空所有窗口与 state 绑定。
- 插件清单现同时要求 `node-repl` 与隐藏 `computer-use` 能力；Skill 已改为在持久 REPL 初始化 `globalThis.sky`，并明确禁止直连 helper/pipe/底层 MCP。
- 新增插件原创 `api.md`、`guidance.md`、`confirmations.md`；明确任意 EXE 路径仍被拒绝，这是相对 Codex 更严格的有意边界。
- 宿主新增通用 `plugin-capability` 一次性 permission scope；Computer Use 动作 advisor 在桥接边界执行，`text` 与 `value` 均从审批详情中脱敏。
- 当前验证：Node REPL 9/9、permission/advisor/Node REPL 组合 24/24、插件新 `sky` 测试 2/2；全项目 TypeScript 仍仅有开发前已知 3 个测试类型错误，新增源码为 0。
- 下一步：补 model-tool-surface、plugin-capability permission 与真实 Manager→REPL→plugin facade 集成测试，再跑全量回归与 Windows smoke。

### 2026-07-21 07:21 +08:00 — M7 真实链路与 Agent 全量相关回归通过

- 新增真实 Windows 集成测试，完整经过 `McpManager → anybox.node-repl → 插件 computer-use-client.mjs → 通用能力桥 → 隐藏宿主 facade → 已认证 helper`：
  - 模型工具面确认没有任何 `anybox.computer-use` 底层工具；
  - 插件初始化持久 `globalThis.sky` 后，`sky.list_windows()` 通过真实 helper 返回窗口，公开结果不含 `windowRef/stateRef`；
  - `finance` 高风险意图在宿主边界硬拒绝；
  - `type_text` 在同一个 JavaScript Promise 内等待一次性审批，审批详情不含输入内容，拒绝后返回稳定 `PERMISSION_DENIED`。
- 修复集成测试的配置隔离：测试现在先清理 Node REPL 与 Computer Use 的旧内建绑定再同步，避免前序“保留用户禁用设置”用例影响真实链路基线。
- Computer Use 插件全套测试扩为 25/25 通过；新增覆盖 Codex 风格 `sky` API 映射、截图发射、私有引用、catalog-only 启动、按键/坐标转换与生命周期清理。
- Agent 相关完整回归：92/92 tests、773 assertions 通过，覆盖权限、插件生命周期、Node REPL、model tool surface、broker/named pipe、advisor、telemetry 与真实 Windows 集成。
- 下一步：执行 Desktop 回归、supply-chain/verifier、packaged runtime 重建与四组真实 Windows smoke。

### 2026-07-21 07:28 +08:00 — packaged Node REPL 边界修复与 Windows 最终回归通过

- Desktop 相关回归 71/71 通过，覆盖 managed Agent 启动、Computer Use overlay、Computer Use Settings 与工具设置；Desktop TypeScript typecheck 通过。
- supply-chain 生成/交叉摘要/篡改/未签名 strict-release 阻断 2/2 通过；helper package verifier 报告插件/helper `0.2.0`、protocol `1`、WGC/UIA/physical epoch 与既有 SHA-256 全部正常。
- 四组真实 Windows smoke 全部通过：
  - WGC 遮挡截图一致、最小化 `CU_WINDOW_CHANGED`、负坐标显示器 `x=-2293`；
  - UIA 21 个初始节点、密码过滤、Invoke/Value/Toggle、一次性 state、stale/tree mutation、2,000 节点上限；
  - app catalog 302 项、250 个 packaged app、10 个阻止项、任意路径拒绝、受控启动；
  - physical input epoch、integrity、point ownership、坐标回退、synthetic input、密码键入拒绝、剪贴板并发/恢复。
- 加强 packaged runtime smoke 后发现并修复一个此前未覆盖的打包边界：父级 Desktop `type: module` 会把复制后的 Node REPL `server.js` 误当作 ESM，导致 `require` 启动失败。
  - Node REPL 运行目录现在显式携带 `package.json` / `type: commonjs`；
  - runtime 构建与 verifier 均要求该边界文件存在；
  - 源码 Node REPL 测试新增 CommonJS 边界断言并保持 9/9 通过。
- 重新生成 `packages/desktop/build/agent-runtime-computer-use-final` 后：
  - 普通 verifier 通过，Computer Use 15 artifacts、媒体运行时与依赖均正常，`Authenticode=NotSigned`；
  - packaged smoke 确认 `anybox.node-repl` 只有 `js/js_reset/js_add_node_module_dir` 3 个通用工具，且包含中性 capability bridge；
  - `anybox.computer-use` 的 14 个操作仅作为隐藏宿主能力可诊断；
  - `--release-strict` 对未签名 helper 按预期以 Authenticode 原因拒绝。
- 下一步：最终 diff、格式、清单/Skill/文档一致性检查后关闭 M7。

### 2026-07-21 07:33 +08:00 — M7 完成

- 目标开发报告升级为 1.1，并加入 M7 架构修订：报告中的 MCP facade 明确限定为模型不可见的宿主内部能力层；模型入口是通用 Node REPL，Computer Use 业务位于插件。
- Node REPL capability 回调进一步要求 canonical Anybox ownership，用户或第三方占用同名 server ID 时不会获得桥接；Node REPL、隐藏工具面和真实 Windows 链路定向复验 14/14 通过。
- 使用最后一版 Agent 源码再次重建独立 packaged runtime；普通 verifier 与增强 smoke 同时通过，确认 3 个通用 REPL 工具、通用 bridge marker 和 14 个隐藏宿主操作。
- 最终静态检查：
  - `git diff --check` 通过（仅有仓库既有的 Windows LF/CRLF 提示）；
  - 插件 manifest 与 Node REPL CommonJS package boundary 均可严格 JSON 解析；
  - 所有新增/修改 JavaScript 入口通过 `node --check`；
  - Agent 全项目 TypeScript 仍仅有开发前已知 3 个测试类型错误，M7 新增源码无错误。
- M7 工程实现与本机验收关闭。剩余项目均为发布外部条件：正式 Authenticode 证书、clean-checkout 复现和 125/150/200% DPI、锁屏、device-loss 独立 Windows 矩阵。

## 验证记录

- 显式枚举 `tests/*.test.mjs` 后执行 `node --test`：25/25 通过。
- `dotnet build ...ComputerUse.Helper.csproj -c Release`：通过，0 warning / 0 error（含 WGC/D3D11 后端）。
- `package-helper.ps1`：通过；真实 helper 报告插件/helper `0.2.0`、protocol `1`。
- `node scripts/smoke-wgc.mjs`：通过；遮挡前后目标颜色标记一致，遮挡窗口像素为 0，最小化错误语义正确。
- `node scripts/smoke-uia.mjs`：通过；password 过滤、document text 限额、Invoke/Value/Toggle、stale revision、tree mutation 与 2,000 节点截断均正确。
- `node scripts/smoke-app-catalog.mjs`：通过；302 个应用、250 个 packaged app、稳定 app ID、任意路径拒绝与受控启动均正确。
- `node scripts/smoke-safety.mjs`：稳定化后连续 3/3 通过；物理输入 epoch、integrity、point ownership、密码键入拒绝和剪贴板并发保护均正确。
- Anybox 本地 catalog 加载：通过；ID `computer-use-windows`、MCP `plugin.computer-use-windows.windows`、Skill `plugin:computer-use-windows:computer-use` 均正确。
- `bun test Test/plugin.test.ts`：49/49 通过，591 assertions。
- M7 最终 Computer Use 相关跨层矩阵：Agent 92/92、Desktop 71/71、插件 25/25、supply-chain 2/2；独立 packaged runtime 验证 3-tool 通用 Node REPL + 14-operation 隐藏宿主能力。

## 已知风险与边界

- 阶段 A 的旧 plugin-owned helper 路径不具备可信边界；当前 M7 模型链路不使用该路径，而由宿主 broker 持有 helper。
- Windows Computer Use 必须在活动桌面前台运行；WGC 改善遮挡截图，但不承诺锁屏、最小化或后台桌面输入。
- 宿主 permission advisor 已支持参数动态审批，但所有输入和应用启动动作仍保持 `ask`；应用访问授权是与工具审批分离的第二道门。
- 截图、UIA 文本、窗口标题、输入文本与剪贴板内容不得写入普通日志。
- 当前 helper 未签名，不能作为 production release；正式打包版已经强制 `Valid` Authenticode，必须先取得发布证书。
- UAC secure desktop、锁屏桌面与更高完整性级别目标不在可控范围内，且不会尝试绕过。
