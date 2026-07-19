# 节点 13：端到端示例

[上一节点](./12-content-overlay-and-popup.md) ·
[下一节点](./14-lifecycle-security-limits-and-debugging.md)

## 首次初始化

```text
Agent 加载 Chrome Skill
→ 选择 connector.node-repl.default/js
→ 从 Skill 绝对路径推导插件根
→ import scripts/browser-client.mjs
→ setupBrowserRuntime({globals})
→ 保存 agent.browsers
```

此时只安装 JavaScript binding；第一次 `getDefault()` 或 `status()` 才触发 host request。

## 获取标签页

```text
Browser Client: getInfo
→ nodeRepl.requestHost("browser", getInfo)
→ MCP Client 验证 host token
→ runtime-host 读取 Bridge backend info
→ Browser Client 构造 capability-filtered BrowserContext

Browser Client: tabs.list
→ nodeRepl.requestHost("browser", command)
→ Agent 注入可信 tool context
→ Command Gateway 校验
→ Bridge 发 command
→ Native Host IPC
→ Chrome Extension
→ result 原路返回
```

## 截图

```js
globalThis.tab = await chrome.tabs.get(7)
await nodeRepl.emitImage(await tab.screenshot())
```

Extension 返回 `{mime:"image/png",data:"..."}`；Node REPL 将它转换为 MCP image content，
而不是把大段 base64 当普通文本返回。

## reset

`js_reset` 只清理当前 Node globals。它不会：

- 停止 Agent Browser IPC Gateway；
- 断开 Native Host；
- 卸载 Chrome 插件；
- 删除平台 Node REPL connector。

下一次使用时 Agent 重新导入 Browser Client。
