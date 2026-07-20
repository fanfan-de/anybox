# 节点 06：Browser Contract、Policy 与 Command Gateway

[上一节点：Browser Host Gateway](./05-agent-ipc-listener-and-gateway.md) ·
[返回总览](./README.md) ·
[下一节点：Extension Bridge](./07-browser-extension-bridge.md)

权威实现位于插件：

- `packages/chrome-plugin/shared/src/browser-contract.ts`
- `packages/chrome-plugin/browser-host/src/browser-policy.ts`
- `packages/chrome-plugin/browser-host/src/command-gateway.ts`

处理顺序为：

1. 校验 Contract version 和 method；
2. 解析并规范化 params；
3. 依据已协商 Backend capability 和 origin policy 授权；
4. 对 v2 命令校验 tab lease，并生成绑定当前 tool call、origin、tab 和 runtime
   验签公钥的短时 challenge；
5. AnyboxAgent 审批后用仅驻留 Agent 的 Ed25519 私钥签发一次性 receipt；
6. Browser Host 使用当前已认证 runtime 连接的公钥验签，并拒绝过期、重放、跨请求
   或跨连接密钥的 receipt；
7. 通过 Extension Bridge 派发并校验 result；
8. 更新插件 Host 内的 tab ownership 元数据。

Browser Client 的校验是友好预检，Browser Host 的校验才是最终边界。raw JavaScript
与 unrestricted CDP 不在命令集合中。
