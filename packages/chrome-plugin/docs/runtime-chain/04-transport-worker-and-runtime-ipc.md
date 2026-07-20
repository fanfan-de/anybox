# 节点 04：Browser Client ↔ Browser Host IPC

[上一节点：Browser Client](./03-browser-client-runtime.md) ·
[返回总览](./README.md) ·
[下一节点：Browser Host Gateway](./05-agent-ipc-listener-and-gateway.md)

Browser Client 从用户私有 runtime bootstrap 读取 endpoint、broker instance 和 proof，
然后完成：

1. 连接 Named Pipe 或 Unix Domain Socket；
2. 接收 Host challenge；
3. 把 Agent 注入的浏览器审批验签公钥加入协议 transcript；
4. 对完整 transcript 计算 HMAC 并发送 runtime hello；
5. 校验 ready 与应用 capability；
6. 发送带唯一 `requestID` 的 `runtime.request`。

若 bootstrap 或连接失效，Client 启动同目录 `browser-host.mjs` 并重试。Client 与 Host
都属于 Chrome 插件；这里没有 MCP 反向 JSON-RPC，也没有 `nodeRepl.requestHost`。
Browser Host 按 runtime 连接保存验签公钥，不再依赖首次启动 Host 的进程环境，因此
Agent 重启或 Host 被其他 Node 会话复用时不会留下过期/缺失的全局验签状态。私钥始终
只存在于 AnyboxAgent。

runtime role 只能发送 `status`、`getInfo` 和 `command`。native-host role 使用独立
endpoint、proof 和消息类型，两个角色不能互换。
