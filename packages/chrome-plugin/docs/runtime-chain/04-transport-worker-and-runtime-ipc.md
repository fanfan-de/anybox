# 节点 04：MCP Host Service Bridge

[上一节点](./03-browser-client-runtime.md) ·
[下一节点：Agent IPC Gateway](./05-agent-ipc-listener-and-gateway.md)

文件名保留旧编号以避免破坏文档链接；0.8.0 已没有 Transport Worker。

## 反向 JSON-RPC

通用 Node Server 在现有 MCP stdio 上发送：

```json
{
  "method": "anybox/node-repl/host-request",
  "params": {
    "service": "browser",
    "request": { "type": "status" },
    "token": "<opaque one-time token>"
  }
}
```

Anybox MCP Client 只为平台 owner 的 `connector.node-repl.default` 注册处理器。处理器：

1. 查找仍在执行的 token；
2. 取出由 Agent 保存的可信 session/message/toolCall context；
3. 拒绝未知 service；
4. 把 `browser` 转给 `runtime-host.ts`；
5. 返回 `{ok,data}` 或带稳定 code/retryable/details 的错误。

Node Server 将失败 envelope 恢复为 Error，Browser Client 因而可以保留 Agent
错误元数据。

## 为什么不再需要 Worker

旧 Worker 的主要任务是持有 Runtime IPC proof。新链路复用已认证的 MCP 连接和一次性
tool-call token，Browser Client 直接回到同一个 Agent 进程。通用 Node 子进程不再得到
Browser IPC secret，因此也没有要在 Worker 中隔离的 proof。

这不是把 Node REPL 变成安全沙箱。`js` 仍是高风险通用代码执行能力；浏览器权限的
权威边界仍是 Agent Command Gateway。
