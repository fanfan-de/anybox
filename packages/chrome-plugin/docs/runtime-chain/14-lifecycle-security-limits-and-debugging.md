# 节点 14：生命周期、安全边界与调试

[上一节点](./13-end-to-end-walkthroughs.md) · [总览](./README.md)

## 生命周期

| 对象 | 创建 | 结束 |
|---|---|---|
| Anybox Node REPL 进程 | MCP Client 首次连接 | 项目运行时释放或进程退出 |
| Browser Client globals | Agent 首次 import/setup | `js_reset` 或 Node 进程退出 |
| Host token | 每次 Node tool call | tool call 完成/失败/取消 |
| Agent Browser IPC Gateway | Agent Server 启动 | Agent Server 停止 |
| Native Host 连接 | Chrome 建立 native port | Chrome/Host/Agent 断开 |
| Extension Service Worker | Chrome 唤醒 | Chrome 回收或扩展重启 |

## 安全判断

- Node REPL 是高风险通用执行环境，不是恶意代码沙箱。
- Chrome 插件不拥有 Node 进程，也不能向它注入 Browser IPC secret。
- Host token 只能把反向请求关联到当前外层 tool call；真正授权仍由 Browser Policy。
- `request.context` 中的伪造字段不会覆盖 Agent 保存的 context。
- Browser Client 本地校验用于早期失败，Agent 校验才是权威边界。
- Native Host proof 是短时本机认证，不是对端进程签名证明。

## 常见故障

| 现象 | 检查 |
|---|---|
| 找不到 `js` | `connector.node-repl.default` 是否被项目选中 |
| Browser Client import 失败 | 是否从 Skill 绝对路径推导了正确插件根 |
| `requestHost` 不存在 | 是否误用了旧插件私有 Node Server |
| Host request unauthorized | 是否在外层 `js` 已结束后复用异步任务 |
| Chrome disconnected | Extension、Native Host manifest、Agent Gateway 状态 |
| Contract mismatch | Extension capability contractVersion |
| `CAPABILITY_UNAVAILABLE` | backend 未声明命令，或 raw JS/CDP 本来就被禁用 |

## 不应再出现

如果生成插件包中出现以下任一文件，说明打包或迁移回退：

```text
scripts/node-repl-server.js
scripts/browser-gateway-worker.js
scripts/browser-ipc-client.cjs
```

打包验证会直接拒绝这种状态。
