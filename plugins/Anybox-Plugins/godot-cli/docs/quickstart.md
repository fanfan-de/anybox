# Anybox 插件

Godot CLI v0.6.0 可以打包为 Anybox 的纯 Skill 插件。Anybox 插件本身不启动进程、不修改 Godot 项目，也不增加 MCP、HTTP 服务或额外运行时；它只提供操作 Skill、安装 Skill、Godot 编辑器插件源码和 Windows x86_64 Rust CLI。

## 构建

在仓库根目录使用 PowerShell 7：

```powershell
.\scripts\package-anybox-plugin.ps1
```

若正式 release CLI 已由完整发布流程构建，可以跳过重复构建：

```powershell
.\scripts\package-anybox-plugin.ps1 `
  -CliExe .\target\x86_64-pc-windows-msvc\release\godot-cli.exe `
  -SkipBuild
```

输出包括：

```text
dist/
  anybox-plugins/
    godot-cli/
      .anybox-plugin/plugin.json
      skills/
      scripts/
      payload/
      docs/
      assets/
  godot-cli-v0.6.0-anybox-plugin.zip
```

展开目录用于 `ANYBOX_PLUGIN_LOCAL_DIR` 和 Anybox 内置插件仓库。ZIP 仅用于独立安装冒烟测试；不要把 ZIP 提交到 `plugins/Anybox-Plugins`，Anybox release 流程会生成自己的确定性 ZIP、SHA-256 和 registry v2 元数据。

## 本地 Anybox 验证

```powershell
$env:ANYBOX_PLUGIN_LOCAL_DIR = 'C:\Projects\Anybox-for-godot\dist\anybox-plugins'
$env:ANYBOX_PLUGIN_REGISTRY_INDEX_URL = 'off'
Set-Location C:\Projects\Anybox\packages\anyboxagent
bun -e "import * as Plugin from './src/plugin/plugin.ts'; console.log(JSON.stringify(await Plugin.listCatalog(), null, 2))"
```

Catalog 中应出现：

```text
godot-cli
plugin:godot-cli:godot-cli
plugin:godot-cli:godot-cli-setup
```

安装生命周期测试：

```powershell
.\scripts\test-anybox-plugin.ps1
```

测试只使用 `test/.tmp` 下生成的临时 Godot 项目，不连接真实编辑器。

## 部署到 Godot 项目

Anybox Agent 加载 `godot-cli-setup` Skill 后，会先调用包内 `scripts/install-project.ps1` 做只读预检。只有用户明确要求安装或升级后才添加 `-Apply`；已有不同文件还需要单独的 `-Upgrade`。

安装目标固定为：

```text
<project>/addons/godot_cli/
<project>/.godot-cli/bin/godot-cli.exe
<project>/.godot-cli/anybox-install.json
```

安装器验证包内所有文件的 SHA-256，失败时回滚本次事务。升级会把被替换的文件备份到 `.godot-cli/backups/godot-cli/`。卸载只删除安装清单中哈希未变化的受管文件，并保留轨迹、备份、未知文件和用户数据。

安装完成后，用户仍需在 Godot 的 **项目 > 项目设置 > 插件** 中启用 **Godot CLI**。脚本不会编辑 `project.godot`，也不会修改系统 `PATH`。

## 同步到 Anybox 内置目录

经过本地验证后，把展开包同步到：

```text
C:\Projects\Anybox\plugins\Anybox-Plugins\godot-cli
```

然后在 Anybox 仓库运行：

```powershell
pnpm plugins:index
pnpm plugins:index:check
pnpm plugins:release:test
```

源 `.anybox-plugin/plugin.json` 不应包含 `package` 字段。正式 Anybox Release 会根据受版本控制的展开包写入不可变 ZIP URL、SHA-256 和精确大小。
