# 节点 12：Content Overlay 与 Extension Popup

[上一节点：Command Executor](./11-extension-command-executor.md) ·
[返回总览](./README.md) ·
[补充：端到端时序](./13-end-to-end-walkthroughs.md)

## 1. 这不是命令主传输链

Content script 和 Popup 都不负责把 browser command 从 Agent 送到 Chrome：

```text
主链：
Service Worker → Command Executor → Chrome API

辅助链：
Command Executor → Content Script → 页面右下角提示
Service Worker storage → Popup → 连接状态
```

它们提供用户可见性和手动重连入口。即使二者失效，主链部分命令仍可能工作；反过来，
Popup 显示 Connected 也不严格证明主链端到端 ready。

## 2. Content Script 何时注入

manifest 声明：

```json
{
  "matches": ["<all_urls>"],
  "js": ["content.js"],
  "run_at": "document_start"
}
```

源码：

[`content/overlay.ts`](../../browser-extension/src/content/overlay.ts)

它只监听一类 Extension message：

```text
ANYBOX_BROWSER_BRIDGE_ACTIVE
```

收到后才创建或更新 overlay，不主动读取页面内容，也不把网页消息转发给 Service Worker。

## 3. Overlay 怎样显示

第一次动作通知时，在 `document.documentElement` 下创建：

```html
<div id="anybox-agent-overlay-root" aria-hidden="true">
  Anybox is controlling Chrome
</div>
```

样式特点：

- 右下角固定；
- 最高级 z-index；
- `pointer-events:none`，不拦用户点击；
- 深色半透明；
- 默认 opacity 0。

显示时：

- 可带 `action`，文字变为 `Anybox: Clicking` / `Anybox: Typing`；
- 2.5 秒后淡出；
- 连续动作会重置 hide timer。

overlay 节点不删除，只切换 opacity/transform。

## 4. 哪些命令会触发 Overlay

当前 Command Executor 在以下动作成功后 best-effort 发消息：

| 命令 | action 文本 |
| --- | --- |
| `page.click` | 通用 “Anybox is controlling Chrome” |
| `page.clickElement` | `Clicking` |
| `page.fill` | `Typing` |
| `page.type` | 通用 |
| `page.scroll` | 通用 |

以下读取命令不会显示：

```text
tabs.list
snapshot / interactiveSnapshot
domTree / accessibilityTree
screenshot
waitFor
```

消息发送使用 `.catch(() => undefined)`，所以：

- content script 不存在；
- Chrome 受保护页面无法注入；
- tab 导航中；

都不会让主 browser command 因 overlay 失败。

Overlay 表示“Extension 刚执行完一个带提示的动作”，不表示动作达成了用户的最终业务
目标。例如 click 事件已发出，不代表表单提交一定成功。

## 5. Popup 的数据来源

源码：

- [`popup/main.ts`](../../browser-extension/src/popup/main.ts)
- [`shared/status.ts`](../../browser-extension/src/shared/status.ts)

Service Worker 把状态写入：

```text
chrome.storage.local["ANYBOX_BRIDGE_STATUS"]
```

结构：

```ts
{
  state: "connected" | "connecting" | "disconnected",
  lastChecked: number,
  transport?: "native",
  hostName?: string,
  error?: string
}
```

Popup 打开时：

1. 先发 `ANYBOX_RECONNECT_BRIDGE`；
2. 从 storage 读取 status；
3. 渲染颜色、label、detail；
4. 监听 `chrome.storage.onChanged` 实时更新。

## 6. Reconnect 按钮做什么

点击：

```text
向 Service Worker 发 ANYBOX_RECONNECT_BRIDGE
  → 本地先显示 connecting
  → 500ms 后再次 loadStatus
```

Service Worker 的 `connectAnybox()` 如果已有 active transport 或正在 connecting，会直接
返回。因此按钮不是“强制断开再重建”，只是“如果当前没有连接，立即发起一次连接检查”。

后台指数重连 timer 仍是主要自动恢复机制。

## 7. 三种容易混淆的状态

| 观察 | 精确含义 |
| --- | --- |
| Popup `Connected` | Service Worker 已创建 Native Messaging Port，并写入 storage |
| `chrome.status().connected === true` | Browser Client 经 MCP host service 看到已连接 Extension |
| `chrome.status().connected === true` | Agent Bridge 有 compatible active Extension connection |

只有第三项最接近“浏览器 backend 端到端可用”。即便为 true，下一条具体命令仍可能因
tab 关闭、Chrome 页面限制、debugger 冲突或超时失败。

## 8. Popup 错误来自哪里

`error` 通常来自：

```text
chrome.runtime.lastError.message
```

它主要描述 Extension ↔ Native Host Port，例如：

- Host 未找到；
- Host 退出；
- Native Messaging 连接断开。

它不包含完整 Agent `lastCommand`、Contract compatibility 或 Runtime connection 状态。
深度诊断要看 `chrome.status()`、Agent Browser IPC/Extension Bridge 日志和 Host stderr。

## 9. 本节点的限制

- Overlay 不是审计日志，只显示 2.5 秒；
- 只在动作完成后通知，不在动作开始前；
- Popup status 没有 Agent hello ack；
- Popup 不显示 Contract version/capabilities；
- Popup 不显示正在执行的命令；
- Reconnect 不会重启 Anybox Agent 或重新注册 Host；
- Content script 不参与 elementId 扫描；扫描由 Service Worker 的 scripting injection
  完成。

主节点文档到这里结束。下一篇用完整时序把这些节点串起来。
