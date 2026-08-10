# Cinema App Plugin

Cinema 0.3.0 是 Anybox App Plugin 的首个 Local Runtime 纵向切片。安装包同时携带：

- `web/`：由 `packages/cinema-web` 构建的相对路径静态资源；
- `runtime/`：由 Anybox 通用 App Runtime Supervisor 启动的本地 HTTP Runtime；
- `skills/` 与 `scripts/`：可选的 Agent Skill 和 MCP helper；
- `.anybox-plugin/plugin.json`：Right Sidebar View、Runtime 与权限声明。

插件模式下，Cinema Web 请求同源 `/__anybox_runtime__/api/cinema/*`。Anybox Gateway 根据 View 的真实插件归属转发到 Runtime，页面不会接触 Runtime 端口或 Token。独立开发模式仍可通过 `agentBaseURL` 连接现有 Agent API。

## 构建

在仓库根目录运行：

```powershell
corepack pnpm cinema:plugin:build
```

命令会重新生成 `web/` 和 `runtime/`，并把 Cinema Provider manifests 复制到 Runtime 包。生成产物是正式插件的一部分，必须随版本一起验证和提交。

## 当前迁移边界

Runtime 已作为插件进程分发和启动，但构建时仍复用 `packages/anyboxagent/src/cinema`、Cinema Route 与 Use Case 源码，并兼容读取现有 Agent 数据目录。这保证现有项目和 Provider 设置在迁移期可继续工作，但不代表领域代码已经完全离开 Anybox Core。

后续迁移目标是把 Cinema 的领域源码、持久化、Provider 和数据迁移全部移入插件源码树，再删除 Agent 中的 Cinema 专用 API。完整状态与验收标准见 `docs/anybox-app-plugin-design.md`。
