---
name: Chrome
description: "通过持久化 Node REPL 控制用户的 Chrome 浏览器，适用于依赖现有标签页、已登录会话、扩展程序、页面可见状态或 UI 交互的任务。对资源执行语义操作时，优先使用专用连接器、API 或 CLI。"
---

# Chrome

## 停止：执行浏览器操作前，先选择正确的操作方式

用户明确表达的 Chrome 使用意图优先。如果用户点名 Chrome 或本插件，要求在 Chrome 中打开页面或导航到某个页面、检查页面的视觉或交互状态，或执行 UI 交互，请继续使用本技能，不要擅自改用其他浏览器。

否则，应将 URL 或已打开的标签页视为上下文，而不是浏览器操作意图。在对链接资源执行每一项语义操作前，先检查可用工具；如果支持工具发现，则通过工具发现查找适用的连接器、API 或 CLI。当专用操作方式能够完成任务时，优先使用它。仅在不存在此类操作方式、它缺少所需能力、任务依赖 Chrome 现有状态，或仍需执行 UI 操作时使用 Chrome。

将本技能用于导航、检查页面可见状态、测试本地 Web 应用、点击、填写、输入、滚动、等待页面变化和截图。

## 仅使用 Anybox Node REPL

只能通过 Anybox 通用 Node REPL 的 `js` 工具控制 Chrome。其完整的 Anybox 工具 ID 通常类似于 `mcp__connector_node_repl_default__js`。不要为此 Chrome 操作界面使用逐项操作的 `browser_*` MCP 工具、Computer Use、独立 Playwright 或其他浏览器控制插件。

`js_reset` 工具只能清除持久化 JavaScript 状态。`js_add_node_module_dir` 工具只能更改 CommonJS 模块解析路径。在尝试启用 `js` 时，不要调用这两个辅助工具。

将配置细节保留在内部。除非用户询问具体实现，否则请用自然语言描述进度，例如正在连接 Chrome、检查页面或重试连接。

Browser Client 只会将协商后的 Browser Contract 所声明的操作，通过已认证的本地 IPC 发送给插件自带的 Browser Host。客户端会先执行 schema 和能力检查，Browser Host 则会再次对每条命令进行权威校验，然后才允许命令到达 Chrome。通用 Node 环境不提供浏览器 Host Service API；不要调用或期待存在 `nodeRepl.requestHost(...)`。

## 安全地初始化和重新加载

Node REPL 是 Anybox 通用环境。它会预加载 `nodeRepl`，但不会预加载 `browser-client`、`setupBrowserRuntime`、`agent` 或 Chrome 专用能力。

导入并初始化 Browser Client 时，会按需从同一个插件包中启动 Browser Host 或与其重新连接。除非用户明确询问具体实现，否则将该生命周期保留在内部。

加载本技能时显示的绝对路径以 `skills/chrome/SKILL.md` 结尾。从该技能目录向上移动两级，解析出本插件的包根目录。随插件提供的 Browser Client 位于包根目录下的 `scripts/browser-client.mjs`。必须通过绝对文件 URL 导入这个文件。绝不要导入外部或内置的 `browser-client` 包。如果随插件提供的文件缺失，请停止并报告 Chrome 插件包不完整。

从当前加载的插件包中导入 Browser Client。只要该插件包版本仍在使用，就复用这个客户端；使用 Chrome 前，应替换从旧版插件中保留下来的 Browser Client。初始化一个持久化 Chrome 绑定，并在首次使用时完整读取其运行时文档：

```js
const { resolve } = require("node:path")
const { pathToFileURL } = require("node:url")
const pluginRoot = "<根据本技能的加载路径推导出的插件绝对根目录>"
const browserClientPath = resolve(pluginRoot, "scripts", "browser-client.mjs")
const { setupBrowserRuntime } = await import(pathToFileURL(browserClientPath).href)
if (
  globalThis.agent?.browsers == null
  || globalThis.setupBrowserRuntime !== setupBrowserRuntime
) {
  await setupBrowserRuntime({ globals: globalThis })
  globalThis.chrome = undefined
}
if (globalThis.chrome == null) {
  const readiness = await agent.browsers.ensureReady({ launch: true })
  if (readiness.state !== "ready") return readiness
  globalThis.chrome = await agent.browsers.getDefault()
  nodeRepl.write(await chrome.documentation())
}
```

在导入的配置函数仍与 `globalThis.setupBrowserRuntime` 匹配时，跨后续调用和用户轮次复用 `globalThis.chrome`。如果两者不匹配，说明持久化 REPL 保留了旧版插件；此时请使用当前加载的插件包重新初始化，并丢弃过期的 Chrome 绑定。不要仅仅因为用户发送了一条新消息，就初始化另一个浏览器运行时。

`agent.browsers.readiness()` 会报告当前连接状态，但不会启动 Chrome，也不会运行 Native Host 探测。在明确的 Chrome 任务中，`agent.browsers.ensureReady({ launch: true })` 会先等待正在进行的扩展重新连接，随后通过已认证的本地 IPC 探测验证已安装的 Native Messaging Host；必要时最多打开 Chrome 一次，并在有限时间内等待扩展握手。它绝不会扫描 Chrome 配置文件或凭据存储。

连接状态不明确时，检查或恢复连接：

```js
return await agent.browsers.ensureReady({ launch: true })
```

`chrome.status().authorizationVerificationAvailable` 是回执验证是否就绪的信号。`peerProcessIdentityVerified` 仅报告当前 PID/SID/uid 验证的限制，不会阻止浏览器命令。

请直接根据返回状态进行处理，不要把所有失败都当作普通的断开连接：

- `ready`：继续使用现有的 `chrome` 绑定；如果绑定不存在，则初始化它。
- `needs-extension`：Chrome 已打开，但扩展没有连接。要求用户安装或启用 Anybox Chrome 扩展，然后重试。
- `needs-extension-update`：要求用户更新 Anybox Chrome 扩展；不要绕过 Browser Contract 不匹配的问题。
- `needs-native-host-repair`：Native Messaging Host 安装或已认证的本地通道失败；要求用户修复或重新安装 Chrome 插件。
- `browser-not-installed`：报告未找到 Google Chrome。
- `backend-unavailable`：仅当 `retryable` 为 `true` 时重试一次；如果问题仍然存在，请报告返回的 `error.code` 和 `error.message`。

当 `ensureReady` 返回非就绪状态后，不要持续轮询或反复打开 Chrome。

## 使用标签页

打开新标签页前，先列出现有标签页，避免重复打开：

```js
return (await chrome.tabs.list()).map(({ id, title, url, active }) => ({
  id,
  title,
  url,
  active,
}))
```

明确绑定选中的标签页，并将其持久保存：

```js
globalThis.tab = await chrome.tabs.get(123) // 将 123 替换为返回的标签页 ID。
return await tab.snapshot()
```

打开新标签页时，持久保存 `open` 返回的对象：

```js
globalThis.tab = await chrome.tabs.open("https://example.com/")
return await tab.snapshot()
```

`chrome.tabs.list()` 返回的条目还包含一个已绑定的 `runtime` 属性，可在同一次调用中使用。跨多次调用时，优先使用明确的标签页绑定。

如果标签页丢失、过期或已关闭，只丢弃 `globalThis.tab`，然后从现有 `chrome` 绑定中获取或创建新的标签页。标签页列表为空不会使浏览器绑定失效。

## 检查与交互

优先使用能够完成任务的最高层级操作：

- 使用 `tab.snapshot()`、`interactiveSnapshot()`、`domTree()` 或 `accessibilityTree()` 检查页面。
- 执行元素操作前，先使用 `tab.interactiveSnapshot()`，再将当前的 `elementId` 传给 `tab.clickElement()` 或 `tab.fill()`。
- 导航或执行会改变页面的操作后，使用带有具体 URL、文本、选择器或元素条件的 `tab.waitFor()`。
- 只有在无法使用基于元素的交互时，才使用基于坐标的 `tab.click()`。
- 只有已连接的扩展声明支持结构化定位器时，才能使用它。原始页面 JavaScript 和不受限制的 CDP 均已禁用。

DOM 发生变化后，交互元素 ID 可能会过期。请重新获取交互快照，不要重试旧 ID。

若要将截图作为图片返回，请发送图片，而不是返回其 base64 数据：

```js
await nodeRepl.emitImage(await tab.screenshot())
```

可用 API 包括：

- `agent.browsers.readiness()`、`ensureReady({ launch })`、`list()`、`get("extension")`、`getDefault()` 和 `getForUrl(url)`
- `chrome.browserId`、`chrome.capabilities`、`chrome.status()` 和根据能力过滤的 `chrome.documentation()`
- `chrome.tabs.list()`、`listUser()`、`open(url, options)`、`claim(tabId)`、`activate(tabId)`、`get(tabId)`、`current()` 和 `finalize()`
- `tab.info()`、`activate()`、`snapshot()`、`interactiveSnapshot()`、`domTree()`、`accessibilityTree()` 和 `screenshot()`
- `tab.click()`、`clickElement()`、`fill()`、`type()`、`scroll()`、`waitFor()`、`release()` 和 `markDeliverable()`
- 当扩展声明支持结构化定位器时，可使用 `tab.locator(descriptor).click()`、`fill()`、`textContent()`、`inputValue()` 和 `waitFor()`

不存在 `tab.playwright`、任意页面 JavaScript、不受限制的 CDP、通用键盘 API 或 `waitForSelector()` 兼容别名。

## 身份验证与隐私

不要检查 Cookie、本地存储、会话存储、浏览器配置文件、密码、令牌或其他凭据存储。绝不要使用原始 JavaScript 或 CDP 绕过此规则。

如果用户明确要求使用 Chrome，而身份验证阻止了任务，请要求用户在 Chrome 中登录，并在准备好后告知你。不要仅仅为了绕过登录而使用网页搜索、其他网站或其他浏览器。

<!-- CHROME_SKILL_EOF：这是完整的 Anybox Chrome 技能。 -->
