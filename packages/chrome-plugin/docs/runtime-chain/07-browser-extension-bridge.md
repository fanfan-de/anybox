# 节点 07：Browser Extension Bridge

[上一节点：Contract 与 Policy](./06-contract-policy-and-command-gateway.md) ·
[返回总览](./README.md) ·
[下一节点：Native Host 注册](./08-native-host-registration-and-bootstrap.md)

`packages/chrome-plugin/browser-host/src/bridge.ts` 维护已认证 Native Host 对应的 Extension
连接、待完成命令、活动 Backend 和 tab ownership。

Bridge 只接受打包时固定的 Chrome Extension ID，并对 Extension 广告的 Contract version
和命令集合取 canonical 安全集合。命令结果必须来自拥有该 command ID 的连接；其他连接
伪造的结果会被忽略。

断线会拒绝该连接所有 pending command。重新连接不要求重置模型的 Node 会话，Browser
Client 可以继续复用原有 `chrome` binding。
