# 节点 06：Browser Contract、Policy 与 Command Gateway

[上一节点：Agent IPC Gateway](./05-agent-ipc-listener-and-gateway.md) ·
[返回总览](./README.md) ·
[下一节点：BrowserExtensionBridge](./07-browser-extension-bridge.md)

## 1. 这是当前权威业务边界

MCP host token 或 Native IPC 认证只保证请求来自当前受控链路。它们不会因为 method
字符串是 `page.fill` 就自动知道参数和权限。

真正处理浏览器业务命令的是：

- [共享 Browser Contract](../../../shared/src/browser-contract.ts)
- [BrowserPolicyEngine](../../../anyboxagent/src/browser-extension/browser-policy.ts)
- [Command Gateway](../../../anyboxagent/src/browser-extension/command-gateway.ts)

入口：

```ts
runBrowserRuntimeCommand(request, bridge, policy)
```

它负责：

```text
Contract version
  → method/params schema
  → backend capability
  → 当前策略决策
  → Bridge 调用
  → result schema
  → tab 使用记录
```

## 2. Browser Contract 与传输协议的区别

Browser IPC schema 故意只把 command method 约束为 1–128 字符字符串。这样未来 Runtime
发来新 method 时，Agent 可以返回业务错误：

```text
COMMAND_NOT_SUPPORTED
```

而不是误报成底层：

```text
INVALID_MESSAGE
```

Browser Contract v1 才定义：

- 合法 method 集合；
- 每条命令的 params/result Zod schema；
- public API path 与 signature；
- security class；
- 稳定错误码；
- backend capability；
- API/Documentation Manifest。

## 3. 当前 15 条命令

| Method | Runtime API | Security class | 关键参数 |
| --- | --- | --- | --- |
| `tabs.list` | `chrome.tabs.list()` | `browser-metadata-read` | 无 |
| `tabs.open` | `chrome.tabs.open(url, options?)` | `target-url` | absolute URL、`active?` |
| `tabs.activate` | `chrome.tabs.activate(tabId)` | `tab-lifecycle` | 正整数 tabId |
| `tabs.release` | `tab.release()` | `tab-lifecycle` | 正整数 tabId |
| `page.snapshot` | `tab.snapshot(options?)` | `page-content-read` | tabId、最多 100000 文本字符 |
| `page.interactiveSnapshot` | `tab.interactiveSnapshot(options?)` | `page-content-read` | tabId、最多 500 元素 |
| `page.domTree` | `tab.domTree(options?)` | `page-content-read` | depth ≤ 20、nodes ≤ 5000 |
| `page.accessibilityTree` | `tab.accessibilityTree(options?)` | `page-content-read` | depth ≤ 30、nodes ≤ 5000 |
| `page.screenshot` | `tab.screenshot(options?)` | `page-content-read` | tabId、`fullPage?` |
| `page.click` | `tab.click(x, y, options?)` | `page-interaction` | 有限坐标、mouse button |
| `page.clickElement` | `tab.clickElement(elementId, options?)` | `page-interaction` | 最新 elementId |
| `page.fill` | `tab.fill(elementId, text, options?)` | `page-interaction` | elementId、字符串 text |
| `page.type` | `tab.type(text)` | `page-interaction` | 非空 text |
| `page.scroll` | `tab.scroll(options?)` | `page-interaction` | 有限 scroll delta |
| `page.waitFor` | `tab.waitFor(condition)` | `page-content-read` | 至少一个 condition，≤ 60 秒 |

所有 param object 都是 strict schema，多余字段也会被拒绝。

`tabs.open` 明确禁止 `javascript:`、`data:`、`vbscript:`，并要求 absolute URL。

## 4. 当前明确不在 Contract 中的命令

Extension application protocol 的兼容枚举中仍保留：

```text
page.executeScript
cdp.send
```

但它们不属于 `BROWSER_CONTRACT_COMMAND_METHODS`。如果到达 Extension，也会被显式抛出
`COMMAND_NOT_SUPPORTED`。

Browser Runtime 的 `tab.evaluate()` 和 `tab.cdp.send()` 在更早的位置直接返回
`CAPABILITY_UNAVAILABLE`。这形成 Runtime、Agent Contract、Extension 三层拒绝。

## 5. `runBrowserRuntimeCommand` 的准确顺序

当前 Runtime 总是传 `contractVersion: 1`，主路径为：

```text
1. bridge.backendInfo()
2. parseBrowserCommandParams(method, params)
3. policy.authorize({method, params, backend})
4. bridge.sendCommand(method, params, context/timeout)
5. parseBrowserCommandResult(method, rawResult)
6. updateOwnership(...)
7. 返回 result
```

两个例外：

- `tabs.release` 不发送到 Extension，而是在 Agent 本地删除 owned-tab 记录；
- legacy 无 Contract version 请求可以先补一个偏好/active tabId，再进入同样的解析和授权。

## 6. Legacy optional-tab 兼容路径

旧调用可能不带 `contractVersion`，并省略部分命令的 tabId。Command Gateway 对这些
method 提供兼容：

```text
先尝试 session 的 preferred owned tab
  → 没有时，授权并执行 tabs.list
  → 取 active tab
  → 仍没有则 TAB_NOT_FOUND
```

当前 Browser Client Runtime v0.4.0 总是发送 Contract v1，v1 schema 对这些命令要求
显式 tabId，所以新主路径不会进入此兼容逻辑。

这个兼容选择也不等于 ownership enforcement，只是默认 tab 解析。

## 7. Policy Engine 当前实际检查什么

`BrowserPolicyEngine.authorize(...)` 当前权威检查：

1. method 属于 Browser Contract；
2. backend `connected === true`；
3. backend capability commands 包含该 method。

成功决策返回：

```ts
{
  method,
  security,
  capabilityChecked: true,
  ownershipEnforced: false,
  perActionApprovalEnforced: false
}
```

`params` 已传入 Policy，但当前只为未来 origin/action policy 保留，尚未参与更多判断。

所以现在已经有“命令级 capability policy”，但没有：

- session 生命周期 enforcement；
- tab ownership enforcement；
- claim；
- per-origin permission；
- 逐动作 approval；
- security class 对应的差异化批准。

Security class 现在是机器可读元数据，不等于策略已经按 class 执行。

## 8. 为什么还要 Bridge 再查一次 capability

Policy 获得 `backendInfo()` 后，到真正发送 command 之间，active Extension connection
可能发生切换。

因此 Bridge 的 `sendCommand` 会对真正选中的 active connection 再检查：

```text
connection.browserCommands.includes(method)
```

这关闭了“Policy 检查旧连接能力、命令却发往新连接”的直接 TOCTOU 缺口。客户端、
Policy 和 Bridge 的 capability 检查各自服务于不同时间点。

## 9. 参数和结果为什么多层重复解析

### 参数

```text
Browser Runtime    → 提前给模型友好错误
Agent Gateway      → 权威边界
Extension Executor → 执行前纵深防御
```

### 结果

```text
Extension Executor → 防止内部 handler 返回错误结构
Agent Gateway      → 不信任 Extension backend 结果
Browser Runtime    → 不信任传输/Agent 返回不符合客户端对象模型
```

共享 Contract 让三层使用相同 schema。重复不是浪费，而是跨信任边界的重新验证。

## 10. `tabs.release` 当前真实语义

Command Gateway 对 `tabs.release`：

```text
解析正整数 tabId
  → bridge.releaseOwnedTab(tabId, sessionID)
  → 返回 {tabId, released}
```

它不会：

- `chrome.tabs.remove`；
- 关闭页面；
- detach `chrome.debugger`；
- 通知 Extension；
- 阻止之后继续用同一个 tabId。

`released: false` 可能表示没有记录，或记录属于另一个 session。它不是权限拒绝。

## 11. result 后的 tab 记录更新

`tabs.open` 成功后，如果 context 有 sessionID：

```text
bridge.markOwnedTab(returnedTab, context)
```

其他带 tabId 的命令：

```text
bridge.touchTab(result.tabId ?? params.tabId, context)
```

只有已存在于 owned-tab Map、且 session 相符的记录才更新时间。对用户原有 tab 的普通
访问不会自动创建 owned 记录。

## 12. Extension 错误怎样被公开

Bridge/Extension 错误如果带有合法 Browser Contract error code，Command Gateway 会：

- 保留 code；
- 保留 retryable；
- 把 raw Extension message 映射成稳定、较少泄漏的公共消息。

例如：

```text
PERMISSION_DENIED
  → Browser command '<method>' was denied by the extension backend.

TAB_NOT_FOUND / TAB_NOT_OWNED / TAB_CLAIM_REQUIRED
  → Browser command '<method>' cannot use the requested tab.

BACKEND_UNAVAILABLE
  → The Chrome extension backend is unavailable.
```

未知错误统一变成：

```text
COMMAND_FAILED
Browser command '<method>' failed in the extension backend.
retryable = true
```

因此模型通常看不到 Extension 抛出的所有内部细节，这是有意的边界收敛。

## 13. 稳定错误码

Contract 当前定义：

```text
CONTRACT_VERSION_UNSUPPORTED
COMMAND_NOT_SUPPORTED
INVALID_COMMAND_PARAMS
INVALID_COMMAND_RESULT
BACKEND_UNAVAILABLE
CAPABILITY_UNAVAILABLE
PERMISSION_DENIED
SESSION_REQUIRED
SESSION_ENDED
TURN_ENDED
TAB_NOT_FOUND
TAB_NOT_OWNED
TAB_CLAIM_REQUIRED
DEADLINE_EXCEEDED
CANCELLED
COMMAND_FAILED
```

“错误码已定义”不代表相应能力全部实现。例如 `CANCELLED`、`TAB_CLAIM_REQUIRED` 已为
后续协议预留，但当前主链没有 command cancel 或 claim 流程。

## 14. Backend capabilities 的当前特征位

除了 15-command 集合，backend 还返回 feature flags。默认全部是 `false`：

```text
ownership
claim
locator
cancel
arbitraryJavaScript
scopedCdp
fullCdp
```

Extension 内部使用固定 CDP 命令不代表向模型公开 `scopedCdp`；该 flag 表示客户端可用的
公开能力。

## 15. 本节点的输出

授权、解析通过后，本节点调用 `BrowserExtensionBridge.sendCommand(...)`。下一节点负责
选择一个兼容 Extension connection、分配 commandID、执行 timeout 并匹配 result。
