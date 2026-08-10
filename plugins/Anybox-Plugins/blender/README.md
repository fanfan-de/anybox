# Anybox Blender MCP

Blender MCP 是对 Blender Lab 官方 MCP Bundle 的 Anybox 封装。插件不重写官方服务端，而是固定并随包分发
官方 `v1.0.0` Bundle 的展开内容，再由 Anybox 以本地 stdio MCP 进程启动。

运行链路：

```text
Anybox Agent -> MCP/stdio -> uv + blender-mcp -> TCP localhost:9876 -> Blender MCP extension
```

## 环境要求

1. Blender 5.1 或更高版本；
2. 已安装 [`uv`](https://docs.astral.sh/uv/getting-started/installation/)；
3. Blender 的 `Allow Online Access` 已开启；
4. 已从 Blender Lab 扩展仓库安装并启用官方 MCP 扩展；
5. Anybox 插件端口与 Blender 扩展端口一致，默认均为 `9876`。

如果 Anybox 图形界面进程没有继承终端中的 `PATH`，请在插件设置里填写 `uv` 或 `uv.exe` 的绝对路径。
插件的标准库启动器先按官方 `uv.lock` 同步依赖，但跳过安装项目本身；随后通过 `PYTHONPATH` 直接启动
官方 `blmcp`。Python 环境、uv 缓存和 uv 管理的 Python 都位于插件专用缓存目录，运行时不会修改插件安装包。
如需使用 `*_for_cli` 工具分析未打开的 `.blend` 文件，可另外配置 Blender 可执行文件路径；留空时使用
`PATH` 中的 `blender` 命令。

## Blender 扩展安装

推荐使用 Blender 官方更新渠道：

1. 打开 `Edit -> Preferences -> System`，启用 `Allow Online Access`；
2. 在扩展仓库中添加 `https://lab.blender.org/`；
3. 搜索并安装 MCP 扩展；
4. 保持 Host 为 `localhost`，确认 Port 为 `9876`，启用自动启动；
5. 打开 Anybox 插件设置并运行 MCP 诊断。

官方页面：https://www.blender.org/lab/mcp-server/

## 安全默认值

- 插件风险为 `high`；
- 文档搜索和结构化场景检查可以自动运行；
- 截图、界面导航、渲染和其他未列入自动策略的工具默认要求批准；
- `*_for_cli` 工具可以启动后台 Blender 并读取明确指定的 `.blend` 文件，默认要求批准；
- 任意 Blender Python 执行始终要求批准；
- MCP Host 固定为 `localhost`，清单不提供局域网监听配置；
- 工具批准不是进程沙箱。Blender Python 仍拥有 Blender 进程可访问的本地文件、网络和子进程权限。

处理不可信 `.blend` 文件或敏感素材时，应遵循 Blender 官方建议，在虚拟机或不含敏感数据的环境中运行。

## 上游同步

插件固定官方稳定版，不在用户启动时跟随 `main` 或下载未审核源码。更新上游时运行：

```powershell
node plugins/Anybox-Plugins/blender/scripts/sync-official.mjs
node plugins/Anybox-Plugins/blender/scripts/sync-official.mjs --check
```

同步脚本会下载官方 MCP Bundle、校验固定 SHA-256、拒绝不安全 ZIP 路径与符号链接，然后原子替换
`runtime/blender-mcp`。升级版本时还必须人工审查工具列表、权限和默认策略。

## 开发验证

```powershell
node --test plugins/Anybox-Plugins/blender/tests/plugin.test.mjs
bun plugins/Anybox-Plugins/blender/tests/catalog-smoke.mjs
node plugins/Anybox-Plugins/blender/tests/mcp-smoke.mjs
node plugins/Anybox-Plugins/blender/tests/package-smoke.mjs
pnpm plugins:index:check
pnpm plugins:catalog:test
```

`mcp-smoke.mjs` 不需要启动 Blender：它验证 MCP 初始化、`tools/list`，并调用只读取内置文档的
`search_api_docs`。完整端到端验证还需要在 Blender 中调用 `get_objects_summary`。

## 上游与许可

- 官方项目：https://projects.blender.org/lab/blender_mcp
- 固定 Release：`v1.0.0`
- Bundle：`blender-1.0.0.mcpb`
- License：`GPL-3.0-or-later`

来源和校验值见 [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)。
