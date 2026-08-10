# Anybox Desktop

`packages/desktop` 是 Anybox Agent 的 Electron 桌面壳。当前实现已经不是纯本地 mock UI，而是一个包含 Electron 主进程、`preload` 桥接层、React 渲染层和 `anyboxagent` 后端联动的桌面客户端。

## 当前状态

- 自定义无边框标题栏，菜单和窗口控制由 Electron main 驱动。
- 主工作区支持“对话工作台居中”和“工具工作台居中”两种顶层布局；通过 `Ctrl/Cmd+Shift+L` 打开布局选择器，选择会全局持久化。
- 侧栏以“文件夹工作区”为主视角，从后端拉取项目和会话，再映射成文件夹分组。
- 启动后会请求当前会话的历史消息，并在切换会话时重新回放历史。
- 发送消息优先走 SSE 流式链路，把 reasoning、text、tool 等事件实时渲染到 thread。
- 当后端不可用时，保留 `seedWorkspaces` 作为界面回退数据，保证 UI 可继续演示和开发。

## 目录结构

```text
packages/desktop
├─ src/main                  Electron 主进程、窗口、菜单、IPC、agent 网关
├─ src/preload               window.desktop 安全桥接
├─ src/renderer/src          React 入口
│  └─ app                    组件、hooks、状态映射、流式事件处理
├─ AI_AGENT_FRONTEND_SPEC.md 前端界面结构 / UI / 状态 / 交互规范
├─ DESKTOP_SERVER_API_SPEC.md bridge / IPC / server 契约
├─ FRONTEND_ARCHITECTURE_GUIDE.md 架构与代码阅读导图
└─ ELECTRON_LEARNING_TODO.md 新同学入门清单
```

## 快速开始

在 `packages/desktop` 目录执行：

```powershell
npm install
npm run dev
```

开发模式会优先连接外部 agent 服务；未显式配置时，Electron main 会尝试托管本地 Bun agent runtime：

- `ANYBOX_AGENT_BASE_URL`
  - 设置后直接连接该地址，不启动托管 agent。
- `ANYBOX_DISABLE_MANAGED_AGENT`
  - 设置为 `1` 时禁用 Electron 托管 agent。
- `ANYBOX_AGENT_WORKDIR`
  - 默认值：当前进程工作目录
- `ANYBOX_AGENT_DATA_DIR`
  - Electron 托管 agent 时由 main 注入；agent 的 config/cache/log/state/database 都从该目录派生。

如果 `anyboxagent` 没启动，桌面端仍可用，但会回退到本地 seed 数据和本地 assistant fallback。

## 测试指令

本包内的标准验证命令：

```powershell
npm run typecheck
npm run test
```

需要手动观察桌面行为时：

```powershell
npm run dev
```

如果这次改动同时涉及 `desktop <-> anyboxagent` 协议，请额外在 `packages/anyboxagent` 执行：

```powershell
bun test Test/server.api.test.ts
```

推荐的最低手工验收项：

1. 后端可用时，启动后能加载文件夹工作区和会话列表。
2. 点击不同会话后，thread 会回放对应历史消息。
3. 点击 `Open folder` 可以新增工作区，点击 `Create session` 可以在当前文件夹下新增会话。
4. 删除会话后，侧栏和本地 conversation 状态都能同步更新。
5. 发送消息时，在线模式优先显示流式 trace；离线模式仍能看到本地 fallback 回复。
6. 使用 `Ctrl/Cmd+Shift+L` 切换两种工作区布局；Workbench 与浏览器等工具状态不应因换位而重置，重新启动后应恢复上次选择。

## 文档索引

| 文档 | 作用 | 什么时候必须更新 |
| --- | --- | --- |
| `README.md` | 项目入口、命令、文档导航 | 新增运行方式、命令或文档结构时 |
| `AI_AGENT_FRONTEND_SPEC.md` | 前端界面结构、UI、状态、交互规范的 SSOT | 改了 renderer 行为、命名、状态流或设置页职责时 |
| `DESKTOP_SERVER_API_SPEC.md` | `window.desktop`、IPC、server 路由契约 | 改了 preload/main/server 接口时 |
| `FRONTEND_ARCHITECTURE_GUIDE.md` | 代码结构、模块职责、阅读路线 | 改了模块边界或关键入口时 |
| `ELECTRON_LEARNING_TODO.md` | 新同学上手路径和练习清单 | 阅读路径或工程流程变化时 |

## 文档维护规则

1. 同一个事实只在一份文档里做主说明，其他文档只链接或引用。
2. 涉及 UI 行为的改动，优先更新 `AI_AGENT_FRONTEND_SPEC.md`。
3. 涉及 bridge / IPC / server 路由的改动，优先更新 `DESKTOP_SERVER_API_SPEC.md`。
4. 如果某段内容只是历史背景或学习材料，不写进 SSOT 文档。
5. 文档和实现不一致时，以“同一改动内同时更新文档”为准，不保留长期漂移。
