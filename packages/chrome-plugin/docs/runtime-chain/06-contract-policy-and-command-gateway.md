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
3. 依据已协商 Backend capability 授权；
4. 通过 Extension Bridge 派发；
5. 校验 result；
6. 更新插件 Host 内的 tab ownership 元数据。

Browser Client 的校验是友好预检，Browser Host 的校验才是最终边界。当前 ownership 与
逐动作审批能力仍明确广告为未实现；raw JavaScript 与 CDP 不在命令集合中。
