# 节点 04：Browser Client ↔ Browser Host IPC

[上一节点：Browser Client](./03-browser-client-runtime.md) ·
[返回总览](./README.md) ·
[下一节点：Browser Host Gateway](./05-agent-ipc-listener-and-gateway.md)

Browser Client 从用户私有 runtime bootstrap 读取 endpoint、broker instance 和 proof，
然后完成：

1. 连接 Named Pipe 或 Unix Domain Socket；
2. 接收 Host challenge；
3. 对协议 transcript 计算 HMAC；
4. 发送 runtime hello；
5. 校验 ready 与应用 capability；
6. 发送带唯一 `requestID` 的 `runtime.request`。

若 bootstrap 或连接失效，Client 启动同目录 `browser-host.mjs` 并重试。Client 与 Host
都属于 Chrome 插件；这里没有 MCP 反向 JSON-RPC，也没有 `nodeRepl.requestHost`。

runtime role 只能发送 `status`、`getInfo` 和 `command`。native-host role 使用独立
endpoint、proof 和消息类型，两个角色不能互换。
