# Anybox Chrome 插件工程

[English](./README.md)

该目录是 Anybox Chrome 集成唯一需要人工维护的源码工程。最终可安装插件单独生成到
`plugins/Anybox-Plugins/chrome`。

## 工程结构

```text
packages/chrome-plugin/
  browser-extension/       Vite/TypeScript Chrome 扩展工程
  browser-runtime/         编译为 browser-client.mjs 的 TypeScript 浏览器 SDK
  browser-native-host/     Rust Native Messaging Host 工程
  runtime/                 插件清单、MCP Server 脚本与 Skill 源码
  tools/                   发行目录同步脚本与回归测试
  LICENSE
  README.md

plugins/Anybox-Plugins/chrome/
  .anybox-plugin/          生成后的规范清单
  browser-extension/       生成后的扩展文件
  extension-host/          平台对应的 Rust Native Messaging Host
  scripts/                 生成后的 MCP 与 Node REPL 运行时
  skills/                  生成后的 Chrome Skill
  LICENSE
```

开发者只修改 `packages/chrome-plugin`。最终插件目录会提交到 Git，因为 Anybox
通过 GitHub Tree 整目录下载它；这里不使用 ZIP 分发。

## 构建与同步

在仓库根目录运行：

```powershell
corepack pnpm chrome-plugin:package
```

该命令会先对 `browser-runtime/src/browser-client.ts` 做类型检查，再通过
esbuild 打包压缩为 `browser-client.mjs`，随后构建 Chrome 扩展和 Rust
Native Messaging Host，并按严格允许列表替换最终插件目录。生成的
`plugins/Anybox-Plugins/chrome/scripts/browser-client.mjs` 是构建产物，
禁止直接修改。TypeScript/Rust 源码、测试、工程配置、sourcemap、依赖、
缓存和开发文档都不会进入最终插件。

运行打包回归测试：

```powershell
corepack pnpm chrome-plugin:package:test
```

在不修改文件的情况下检查已提交插件目录是否为最新：

```powershell
corepack pnpm chrome-plugin:package:check
```

提交代码时，应同时提交源码变更和重新生成的
`plugins/Anybox-Plugins/chrome`。

## Native Host 交付

与 Codex Chrome 插件一样，Native Messaging Host 由可下载插件自身交付。
当前平台二进制生成到 `extension-host/<platform>/<architecture>/`，
`scripts/installManifest.mjs` 会为当前用户注册 Chrome Native Messaging
清单，并让清单直接指向插件包内的二进制。Anybox 桌面安装包不再重复携带 Host。
