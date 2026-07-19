# 节点 07：BrowserExtensionBridge

[上一节点：Contract 与 Policy](./06-contract-policy-and-command-gateway.md) ·
[返回总览](./README.md) ·
[下一节点：Native Host 注册](./08-native-host-registration-and-bootstrap.md)

## 1. Bridge 在链路中的作用

[`bridge.ts`](../../../anyboxagent/src/browser-extension/bridge.ts) 是 Agent 内部的
Extension 会话管理器。它把一个已认证 Native Host IPC connection 包装成类似 socket
的对象，然后管理 Extension application protocol：

```text
Extension → hello / result / event / pong
Agent     → command / ping
```

它不拥有本机 socket；socket 由上一节点 Gateway/Sidecar 管理。它也不执行 Browser
Contract 参数解析；那由上一节点 Command Gateway 完成。

## 2. Native Host connection 怎样注册进来

Native Host role 通过 Gateway 认证后，Gateway 调用：

```ts
bridge.register(
  {
    send(data) { /* 包成 native.message 写回 IPC */ },
    close() { /* 结束 IPC connection */ }
  },
  {
    transport: "native-ipc",
    hostName: "com.anybox.browser"
  }
)
```

Bridge 为它分配新的 `connectionID`，初始状态：

```text
ready = false
connectedAt / lastSeenAt
transport = native-ipc
hostName = com.anybox.browser
```

Native Host 已通过 IPC 认证不等于 Extension 已 ready。只有收到并接受 Extension
`hello` 后，该 connection 才能承载 browser command。

## 3. Extension hello 校验

当前 Extension 发送：

```json
{
  "type": "hello",
  "protocolVersion": 1,
  "extensionID": "hjbejdmgpifdjjlpgmdfmbmbhkedgnjc",
  "extensionInstanceID": "...",
  "version": "0.2.0",
  "capabilities": {
    "contractVersion": 1,
    "commands": ["tabs.list", "..."]
  }
}
```

共享 schema 先检查 protocol 和对象形状。Bridge 再要求 Extension ID 与固定 ID 完全
相等；不相等时关闭并注销 connection。

对于 capabilities：

- Contract version 必须等于当前 `BROWSER_CONTRACT_VERSION`；
- commands 与本地 canonical 15-command 集合取交集，并保持 canonical 顺序；
- 不兼容 connection 会保留为 ready 但不能成为 active，便于状态报告版本不兼容。

兼容旧 Extension 的特殊路径：

- 无 capabilities 且 version 匹配 `0.1.x` 时，按 Contract v1 和全部 15 command 处理；
- 其他无 capabilities 版本不兼容。

当前 Extension `0.2.0` 使用显式 capabilities，不走 legacy 分支。

## 4. active connection 怎样选择

Bridge 只向一个 active connection 发命令：

1. 如果已有 `activeConnectionID`，且该 connection `ready`、Contract compatible，继续用；
2. 否则从 connections 中找第一个 ready 且 compatible 的 connection；
3. 没有时返回 backend unavailable。

当 active connection 注销时，Bridge 尝试选择另一个兼容连接。

它没有按 Chrome profile、窗口或用户显式选择 connection 的机制；当前策略是“第一个
可用兼容连接”。

## 5. Backend info 怎样生成

`backendInfo()` 根据 active connection 生成：

```text
contractVersion = 1
browserId       = extension
name            = Anybox Chrome Extension
kind            = extension
connected       = Boolean(active)
protocolVersion = 1
backendVersion  = Extension version
commands        = active connection capability intersection
features        = 全部 false
```

`getInfo()` 再基于 commands 生成 capability-filtered API/Documentation Manifest。

如果只有不兼容 connection：

- `browserContractCompatibility().connected = true`；
- `compatible = false`；
- Runtime `getInfo` 会返回 `CONTRACT_VERSION_UNSUPPORTED`。

## 6. 一条 command 怎样发出

`sendCommand(method, params, options)`：

1. 再次验证 method 属于 Extension protocol enum；
2. 获取 active connection；
3. 检查该 connection 的 `browserCommands` 包含 method；
4. 生成随机 `commandID`；
5. 创建 pending Promise 和 timeout timer；
6. 保存 `lastCommand` 诊断信息；
7. 发送符合 schema 的消息。

消息示例：

```json
{
  "type": "command",
  "commandID": "...",
  "contractVersion": 1,
  "method": "page.fill",
  "params": {
    "tabId": 123,
    "elementId": "anybox-...",
    "text": "hello"
  },
  "context": {
    "sessionID": "...",
    "messageID": "...",
    "toolCallID": "..."
  }
}
```

Bridge 的 socket `send` 接收 JSON string；Gateway 将其 parse 后包为
`{type:"native.message", message}`，再交给 Rust Host。

## 7. timeout 与 pending Map

默认 command timeout 是 `15_000 ms`。Runtime 可以为 `waitFor` 等命令传更长 timeout。

pending 项包含：

```text
commandID
connectionID
method
context
resolve/reject
timer
```

超时后：

- pending 项被删除；
- `lastCommand` 记录失败；
- Promise 以 `DEADLINE_EXCEEDED`、`retryable=true` 拒绝。

Bridge 不发送 cancel 给 Extension。Extension 可能继续执行；迟到 result 因 pending 已
不存在而被忽略。

## 8. result 怎样匹配

Extension result：

```json
{
  "type": "result",
  "commandID": "...",
  "ok": true,
  "data": {}
}
```

Bridge 只接受：

- pending Map 中存在该 commandID；
- pending.connectionID 与发回 result 的 connection 相同。

匹配后清 timer、删除 pending、更新 `lastCommand`：

- `ok:true` → resolve data；
- `ok:false` → 创建 Error，并透传可选 `code/retryable`。

Result 的业务 schema 在下一层返回 Command Gateway 后校验，不在 Bridge 内按 method
解析。

## 9. connection 断开怎样处理

`unregister(connectionID)` 会：

- 从 connections 删除；
- active 是它时选择下一个；
- 遍历 pending，拒绝所有属于该 connection 的命令；
- 记录断开日志。

拒绝消息为：

```text
Browser extension disconnected before returning a result.
```

Command Gateway 随后把未知 backend error 收敛成稳定的 `COMMAND_FAILED`。

## 10. `ping/pong/event`

`bridge.ping()` 向 active connection 发随机 nonce ping；Extension 回 pong。当前 ping
主要是传输探测，没有周期性 heartbeat 驱动 active 选择。

Extension event：

- `transport_error` 会更新 connection 的 `lastTransportError`；
- 其他 event 只写 debug 日志。

当前 Extension 在 server message 解析失败时发的是 `client_error`，所以通常只被记录，
不会更新 `lastTransportError`。

## 11. owned-tab Map

Bridge 保存：

```ts
Map<tabId, {
  tabId,
  sessionID,
  url?,
  title?,
  openedAt,
  lastUsedAt
}>
```

### 创建

只有经 Command Gateway 成功执行 `tabs.open` 且 context 有 sessionID 才
`markOwnedTab(...)`。

### 更新

后续命令的 tabId 已存在、且 context session 匹配时，`touchTab(...)` 更新
`lastUsedAt`。

### 选择

Legacy 省略 tabId 时，`preferredTabID(sessionID)` 返回该 session 最近使用的记录。

### 删除

`releaseOwnedTab(tabId, sessionID?)` 只删除 Map 项。

这份 Map 不参与当前 Policy 的拒绝逻辑。名字叫 owned，并不代表强制 ownership。

## 12. status 与诊断

`status()` 返回：

```text
connected
active connection metadata
connectionCount
activeSessionID
ownedTabs
lastCommand
```

active metadata 包含：

```text
connectionID
extensionInstanceID / extensionID / version
transport / hostName
lastTransportError
connectedAt / lastSeenAt
```

`lastCommand` 可关联 session、message、toolCall，记录开始/结束、成功、错误和 trusted
标记。当前 Runtime 主路径没有把 `trusted` 设置为 true。

## 13. 本节点不保证什么

- 不保证 active connection 对应用户想要的 Chrome profile；
- 不证明 tab 属于 session；
- 不做逐动作批准；
- timeout 不取消底层命令；
- hello 成功没有单独 ack 回 Extension；
- connection `lastSeenAt` 只在收到消息时更新，不是持续健康度。

下一节点先解释 Rust Host 如何被注册并获得一次性 bootstrap；之后再进入 Host 本身。

