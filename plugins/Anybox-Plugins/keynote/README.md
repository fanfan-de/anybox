# Anybox Keynote Studio

Keynote Studio 是 Anybox 的 macOS Keynote 自动化插件初始版。它将固定版本的
[`ByAxe/keynote-mcp`](https://github.com/ByAxe/keynote-mcp) 源码、MCP 运行时和演示设计
Skill 打包在一起，可创建、编辑、检查、截图和导出 Keynote 演示文稿。

## 初始版本能力

- 创建、打开、保存和关闭 Keynote 文稿；
- 新增、删除、复制、移动和选择幻灯片；
- 添加标题、正文、列表、代码、引用、图片和形状；
- 检查并调整元素的位置、尺寸、透明度和演讲者备注；
- 通过辅助功能 UI 脚本添加构建动画；
- 截取单页预览并导出 PDF；
- 可选接入 Unsplash 图片搜索；
- 内置字体裁切修复、坐标计算、主题兼容和版式模板指导。

## 环境要求

1. macOS 10.14 或更高版本；
2. 已安装 Apple Keynote；
3. 已安装 [`uv`](https://docs.astral.sh/uv/getting-started/installation/)；
4. 首次启动时可访问 Python 包索引，以下载 Python 3.12 和锁定依赖。

插件会依次从 `PATH`、`~/.local/bin/uv`、`/opt/homebrew/bin/uv` 和
`/usr/local/bin/uv` 查找 `uv`。如果 Anybox 的图形界面进程无法继承终端 `PATH`，可在安装配置中
填写 `uv` 的绝对路径。

## macOS 权限

首次调用 Keynote 工具时，macOS 会询问是否允许 Python 自动化 Keynote。请在“系统设置 → 隐私与安全性
→ 自动化”中允许。只有构建动画相关工具需要额外的“辅助功能”权限；普通 AppleScript 编辑不需要。

这些权限通常按实际执行的 Python 二进制授予。插件将隔离环境保存在用户缓存目录
`Library/Caches/Anybox/keynote-mcp/1.0.1`，以保持执行路径稳定。

## 安全默认值

- 插件风险标记为 `high`，因为它能修改和删除幻灯片，也能写入导出文件；
- 只有查询演示文稿、主题、布局、内容和备注的检查工具默认自动运行；
- 所有修改、删除、导出、UI 脚本和网络工具默认要求批准；
- Unsplash access key 是可选项，由 Anybox 保存并仅注入 MCP 子进程；
- 未配置 Unsplash key 时，相关工具不会注册。

## 开发验证

从 Anybox 仓库根目录运行：

```powershell
node --test plugins/Anybox-Plugins/keynote/tests/plugin.test.mjs
node plugins/Anybox-Plugins/keynote/tests/mcp-smoke.mjs
node plugins/Anybox-Plugins/keynote/tests/mcp-smoke.mjs --with-unsplash
pnpm plugins:index:check
```

在 macOS 上还应完成一次真实验证：安装插件、运行 MCP 诊断、创建临时演示文稿、截取一页并导出临时
PDF，然后删除测试文件。Windows 和 Linux 只能验证清单、锁文件与 MCP 握手，不能验证 Keynote 自动化。

## 上游与许可

运行时和演示设计 Skill 基于 `ByAxe/keynote-mcp` 的提交
`aca972f8739c024f821ae8d99b293f55b9479ba7`，采用 MIT 许可。完整许可和来源记录见
[`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md) 与
[`runtime/keynote-mcp/LICENSE`](./runtime/keynote-mcp/LICENSE)。
