# 停止：执行任何浏览器操作前，先选择正确的操作界面

明确的浏览器意图优先：如果用户点名应用内浏览器或 Chrome，或者要求打开、显示或导航到某个页面、检查页面的视觉或交互状态，或与页面 UI 交互，请继续使用 Browser，不要改用连接器。

否则，应将 URL 或已打开的浏览器标签页视为上下文，而不是使用浏览器的意图。先前使用过 Browser，并不意味着后续语义操作也应优先使用浏览器。在对链接资源执行每一项语义操作之前，**必须**查询可用工具和延迟加载工具，寻找适用的连接器、API 或 CLI。阅读本技能或浏览当前可见的工具不算完成查询。在查询完成之前，不要为该操作初始化 Browser。如果存在非浏览器工具，请使用它。如果该工具能够处理当前操作，则继续推进整体工作流，但当前操作不要使用 Browser。仅在不存在此类工具、工具无法访问资源或缺少所需能力，或者仍有 UI 操作需要完成时，才使用 Browser；在要求用户重新提供上下文之前，应先利用已有的浏览器上下文。

本技能适用于浏览器自动化任务，例如检查页面、导航、测试本地应用、点击、输入、截图以及读取页面的可见状态。

如果本插件在当前会话中被列为可用，则在开展浏览器工作之前，必须阅读本技能。在声称 Browser 不可用，以及回退到独立 Playwright 或 Computer Use 之前，也必须先打开并遵循本技能。

不要因为 Computer Use MCP 工具调用直接可见或看起来更容易调用，就跳过本技能。Computer Use 工具存在，并不表示 Computer Use 是首选的浏览器操作界面。

## 设置文档

当以下任一设置主题适用时，调用 `await agent.documentation.get("<name>")`：

- `bootstrap-troubleshooting`：浏览器设置成功，但发现或选择浏览器失败时阅读。
- `chrome-troubleshooting`：Chrome 扩展的设置、安装或通信失败时阅读。

## 引导初始化

以下设置细节属于内部信息。面向用户的进度更新应减少技术细节。除非用户明确询问这些信息，否则绝不要提及 Node REPL、`node_repl`、REPL、JavaScript 会话、模块导出、阅读文档或加载说明。如果需要设置或恢复，请自然地描述为正在连接浏览器或重试浏览器连接。

`browser-client` 模块是使用浏览器的核心入口，位于本插件根目录下的 `scripts/browser-client.mjs`。始终使用绝对路径导入它。**重要：**如果找不到该路径，请停止并报告此插件缺少 `scripts/browser-client.mjs`。绝不要使用内置的 `browser-client` 库。

通过 Node REPL 的 `js` 工具运行浏览器设置代码。在此环境中，可调用工具的 ID 通常显示为 `mcp__node_repl__js`。如果该工具尚不可用，请使用工具发现功能搜索 `node_repl js`，且不要设置结果数量上限。你需要的是 `js` 执行工具：`js_reset` 只会清除状态，`js_add_node_module_dir` 只会更改包解析方式。尝试启用 `js` 时，不要调用这两个辅助工具。如果 `js` 仍然不可用，请再次搜索 `node_repl js`，并将 `limit` 设为 `10`。

每个新的 Node 会话只初始化一次运行时。如果 `agent.browsers` 已经存在，请复用它；不要导入或初始化另一个浏览器运行时。

```js
if (globalThis.agent?.browsers == null) {
  const { setupBrowserRuntime } = await import("<plugin root>/scripts/browser-client.mjs");
  await setupBrowserRuntime({ globals: globalThis });
}
```

建立浏览器连接后，请在后续轮次中复用现有的浏览器绑定，不要重新阅读本技能。完整阅读某个浏览器的文档后，除非改为选择另一个浏览器，否则不要重复阅读。

标签页绑定与浏览器绑定彼此独立。如果后续轮次报告某个标签页缺失、已失效、已关闭或不属于当前浏览器会话，请丢弃该标签页绑定，并从现有浏览器绑定中获取或新建标签页。标签页清理后，`browser.tabs.list()` 或 `browser.user.openTabs()` 返回空结果属于正常情况，不表示浏览器绑定失效。绝不要调用 `agent.browsers.get*` 来恢复标签页；只有明确的浏览器断开连接错误才会使浏览器绑定失效。

## 浏览器选择

以下场景仅适用于首次选择浏览器。在调用任何 `agent.browsers.get*` 方法之前，应优先复用已经能够满足任务需要的 `globalThis.browser`、`globalThis.iab` 或 `globalThis.chrome` 绑定。新的用户轮次不会使浏览器绑定失效，也不要求重新选择浏览器或再次调用文档。

请严格按照下列顺序，从这些场景中选择且仅选择一个。用户明确要求应用内浏览器或 Chrome 时，其优先级始终高于 URL 选择。只要用户点名了某个浏览器，就绝不要调用 `getForUrl()`。

应用提供的应用内浏览器上下文只是环境中的 UI 状态，并不代表用户要求选择或切换浏览器。只有用户请求的文字内容才能明确指定浏览器。

不要检查浏览器 Cookie、本地存储、配置文件、密码或会话存储。浏览器发现过程必须保持只读。

当身份验证阻止了用户要求的浏览器导航时，不要为了绕过登录而改用网页搜索、搜索引擎、其他网站或其他信息源。

### 用户明确要求使用某个浏览器

用户请求中提及某个插件，即表示明确指定了该插件对应的浏览器。

- `[@Browser](plugin://browser@openai-bundled)` 指定应用内浏览器。
- `[@Chrome](plugin://chrome@openai-bundled)`、`[@chrome-internal](plugin://chrome-internal@openai-bundled)` 和 `[@chrome-dev](plugin://chrome-dev@openai-bundled)` 指定 Chrome。

请遵循下方对应的明确浏览器场景。

只有当当前会话的技能列表中包含 Browser 技能时，应用内浏览器才可用。如果用户明确要求使用应用内浏览器且该技能可用，请使用独立的持久绑定，并立即完整读取其文档：

```js
if (globalThis.iab == null) {
  globalThis.iab = await agent.browsers.get("iab");
  nodeRepl.write(await iab.documentation());
}
```

如果用户明确要求使用应用内浏览器，但 Browser 技能不可用，请报告应用内浏览器不可用，不要改用其他浏览器。

只有当当前会话的技能列表中包含 Chrome 技能时，Chrome 才可用。如果用户明确要求使用 Chrome 且该技能可用，请使用另一个独立的持久绑定，并立即完整读取其文档：

```js
if (globalThis.chrome == null) {
  globalThis.chrome = await agent.browsers.get("extension");
  nodeRepl.write(await chrome.documentation());
}
```

如果用户明确要求使用 Chrome，但 Chrome 技能不可用，请报告 Chrome 不可用，不要改用其他浏览器。

用户明确选择的浏览器在整个任务期间持续有效。如果身份验证阻碍了在用户明确选择的浏览器中执行任务，下一条回复必须明确要求用户在该浏览器中登录，并在准备好后告知你；但如果该浏览器的文档提供了受支持的身份验证流程，应先尝试该流程。仅仅报告需要登录并不足够。除非用户要求或批准切换，否则不要改用其他浏览器。

### 任务需要浏览器交互，用户未指定浏览器，并且任务有目标 URL

如果用户提供了 URL，或者可以根据请求合理推断出目标 URL，请用该 URL 替换下面示例中的地址，并让 `browser-client` 选择最适合它的浏览器：

```js
if (globalThis.browser == null) {
  globalThis.browser = await agent.browsers.getForUrl("https://example.com/");
  nodeRepl.write(await browser.documentation());
}
```

### 用户既未指定浏览器，也未提供目标 URL

使用运行时默认值：应用内浏览器可用时优先使用它，否则使用 Chrome。不要先列出浏览器：

```js
if (globalThis.browser == null) {
  globalThis.browser = await agent.browsers.getDefault();
  nodeRepl.write(await browser.documentation());
}
```

## 设置完成后

如果设置成功，但浏览器发现或选择失败，请先读取 `await agent.documentation.get("bootstrap-troubleshooting")`，然后再重置 JavaScript 会话或尝试其他浏览器控制机制。

如果故障与 Chrome 扩展的设置、安装或通信直接相关，请先读取 `await agent.documentation.get("chrome-troubleshooting")`，然后再重试或采取其他恢复操作。

如果用户没有明确选择浏览器，运行时选中的浏览器不构成用户约束。不要仅凭对身份验证状态的猜测切换浏览器。如果导航结果表明当前浏览器缺少所需的身份验证，请先选择另一个可用浏览器，再要求用户登录。切换时无需重置 Node 会话。只要现有的 `iab`、`chrome` 和 `browser` 绑定仍有用，就应保留它们。现有标签页始终绑定到创建它的浏览器。选择另一个浏览器后，请先从该浏览器获取一个标签页再继续，并完整阅读该浏览器的文档。

直接与浏览器交互的能力由 `browser-client` 运行时通过 `agent.browsers.*` API 提供。首次尝试与所选浏览器交互之前，**必须**一次性输出并阅读其 `documentation()` 调用所返回的完整文档。首次阅读文档时，请运行上方对应场景中给出的、完全一致的 `nodeRepl.write(await <browser>.documentation());` 直接调用。不要将文档赋给变量，不要检查其长度，不要切片或截断，不要进行摘要，也不要只输出节选。不要主动将文档拆分成分页或分块内容。只有当工具输出本身明确报告内容已被截断时，才可以按较小的分块继续输出和阅读，直至完整读完文档。

只有 Node REPL 的 `js` 工具（`mcp__node_repl__js`）可以用于控制所选浏览器。不要为此操作界面使用外部 MCP 浏览器控制工具、独立的浏览器自动化服务器或其他浏览器技能。文中提到的 Playwright，均指完成 `browser-client` 设置后，本技能内提供的 `tab.playwright` API。

<!-- BROWSER_SKILL_EOF: This is the complete Browser skill. Do not request additional lines. -->
