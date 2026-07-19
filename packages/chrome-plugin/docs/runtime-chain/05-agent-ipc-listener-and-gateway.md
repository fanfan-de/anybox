# 节点 05：插件 Browser Host Gateway

[上一节点：Client ↔ Host IPC](./04-transport-worker-and-runtime-ipc.md) ·
[返回总览](./README.md) ·
[下一节点：Contract 与 Policy](./06-contract-policy-and-command-gateway.md)

文件名保留旧编号以维持文档链接；实现已经不在 Agent。当前源码位于：

- `packages/chrome-plugin/browser-host/src/main.ts`
- `packages/chrome-plugin/browser-host/src/ipc-gateway.ts`
- `packages/chrome-plugin/browser-host/src/ipc-listener-sidecar.mjs`

Browser Host 是插件自有的 Node 进程。它取得用户级 runtime/native-host endpoints，
发布 runtime bootstrap，轮换 Native Host bootstrap，并维护两个认证角色的连接状态。

Host 的 runtime 响应只暴露必要状态，不返回 proof、broker ID、Extension instance ID
或内部 ownership 记录。重复 request ID、角色混淆、协议不匹配和过期 challenge 都会
fail closed。

AnyboxAgent Server 的启动/停止与这个 Gateway 无关。
