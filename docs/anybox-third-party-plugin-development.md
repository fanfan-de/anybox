# Anybox 第三方插件开发指南

> 本页是仓库中的稳定入口。完整规范只维护一份，以随 `anybox-plugin-development` 插件发布的指南为准：
> [完整插件开发指南](../plugins/Anybox-Plugins/anybox-plugin-development/docs/anybox-third-party-plugin-development.md)。

Anybox 插件使用展开式包结构，新插件的规范清单入口是：

```text
<plugin-id>/.anybox-plugin/plugin.json
```

根目录 `plugin.json` 与 `.codex-plugin/plugin.json` 仅作为兼容输入。插件的 `skills`、`scripts`、`connectors`、`docs` 和 `assets` 位于 `.anybox-plugin` 的同级目录。

## 当前开发与发布模型

- 桌面开发版和正式版默认读取同一份稳定 Registry：`plugins/Anybox-Plugins/.catalog/anybox-plugin-registry.json`。
- 默认不扫描仓库源码插件；只有显式设置 `ANYBOX_PLUGIN_INCLUDE_SOURCE_PACKAGES=1` 才进入仓库源码调试模式。
- `plugins/Anybox-Plugins/index.json` 是本地 Catalog 构建输入，不是客户端默认拉取的运行时目录。
- Registry、Catalog Manifest 和版本化 ZIP 全部在本地生成、验证，再作为普通 Git 文件提交。
- 插件目录发布不依赖 GitHub Actions、GitHub Release 或 GitHub API，也不与 Anybox 桌面版本绑定。

仓库插件的发布命令：

```powershell
pnpm plugins:index
pnpm plugins:index:check
pnpm plugins:catalog:prepare
pnpm plugins:catalog:verify
```

验证通过后，提交插件源码、`index.json` 和 `.catalog/`，再执行普通 `git push`。

## 相关文档

- [完整插件开发指南](../plugins/Anybox-Plugins/anybox-plugin-development/docs/anybox-third-party-plugin-development.md)
- [插件模块实现机制](./plugin-module-implementation.md)
- [本地 Connector 设计](./plugin-local-connectors-design.md)
- [官网插件开发文档](../packages/site/src/docs/content/plugin-development.md)
