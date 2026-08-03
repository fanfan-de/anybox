---
name: godot-cli-setup
description: 将 Anybox 插件自带的 Godot CLI 安装、升级、验证或卸载到 Godot 4.6 项目。适用于用户要求安装 Godot CLI、修复 CLI 缺失、升级编辑器插件与 CLI、检查安装完整性，或安全移除由本插件管理的项目文件。
---

# Godot CLI Setup

使用本 Skill 管理插件包内置的 Godot CLI v0.6.0。安装目标仅支持 Windows x86_64 的 Godot 4.6.x 项目。

## 定位脚本

所有路径必须从本 `SKILL.md` 的实际文件位置解析。插件根目录是本文件目录的上两级；不要猜测 Anybox 数据目录，也不要全盘搜索插件载荷。

插件根目录下提供：

- `scripts/install-project.ps1`
- `scripts/verify-project.ps1`
- `scripts/uninstall-project.ps1`
- `payload/SHA256SUMS.json`

调用脚本前先解析它们的绝对路径。始终使用 PowerShell 7 或更高版本。

## 安全边界

- 先确认目标目录中存在 `project.godot`。
- 安装和卸载默认只做预检；只有用户已经明确要求具体安装、升级或卸载后，才添加 `-Apply`。
- 预检要求 `requiresUpgrade: true` 时，必须向用户说明已有文件会被替换；只有用户明确要求升级时才添加 `-Upgrade -Apply`。
- 如果脚本报告受管文件已被本地修改，停止并让用户处理冲突；不要绕过校验或手工强制覆盖。
- 升级前让用户关闭使用该插件的 Godot 编辑器。不要终止 Godot 进程。
- 不修改 `project.godot`，不自动启用编辑器插件，不修改系统 `PATH`。
- 不读取 `%LOCALAPPDATA%\GodotCli\sessions`，不输出或复制会话令牌。
- Anybox 中卸载本插件不会自动删除已经部署到 Godot 项目的文件；项目卸载必须单独明确执行。

## 安装或升级

先运行预检：

```powershell
& <plugin-root>\scripts\install-project.ps1 `
  -ProjectPath <absolute-project-path>
```

核对 JSON 中的 `projectPath`、`version`、`applyRequired`、`requiresUpgrade`、`conflicts` 和 `godotProcessesRunning`。

首次安装或补齐缺失文件：

```powershell
& <plugin-root>\scripts\install-project.ps1 `
  -ProjectPath <absolute-project-path> `
  -Apply
```

经用户明确批准的升级：

```powershell
& <plugin-root>\scripts\install-project.ps1 `
  -ProjectPath <absolute-project-path> `
  -Upgrade `
  -Apply
```

脚本只把编辑器插件部署到 `addons/godot_cli`，把 CLI 部署到 `.godot-cli/bin/godot-cli.exe`，并写入 `.godot-cli/anybox-install.json`。升级备份保存在 `.godot-cli/backups/godot-cli/`。

## 验证

安装后运行：

```powershell
& <plugin-root>\scripts\verify-project.ps1 `
  -ProjectPath <absolute-project-path>

& <absolute-project-path>\.godot-cli\bin\godot-cli.exe --version
```

然后让用户在 Godot 的 **项目 > 项目设置 > 插件** 中启用 **Godot CLI**，保持编辑器打开，再在项目根目录运行：

```powershell
& .\.godot-cli\bin\godot-cli.exe --json --project . doctor
```

将非零退出码或 `"ok": false` 视为失败。版本不一致时不要继续执行编辑器操作。

## 卸载项目文件

先预检：

```powershell
& <plugin-root>\scripts\uninstall-project.ps1 `
  -ProjectPath <absolute-project-path>
```

经用户明确批准后执行：

```powershell
& <plugin-root>\scripts\uninstall-project.ps1 `
  -ProjectPath <absolute-project-path> `
  -Apply
```

卸载只删除安装清单中仍保持原始 SHA-256 的受管文件。它会保留 `.godot-cli/traces`、备份、未知文件和用户数据。
