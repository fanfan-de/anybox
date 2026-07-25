---
name: anybox-mobile-release
description: 开发、验证、打包、预览和发布 Anybox 仓库中的 Android 移动端。适用于规划或执行本地移动端开发、独立开发包与真机测试、debug 或正式签名 APK 构建、原生 fingerprint 检查、preview/production OTA、mobile-v* GitHub/CDN 发布、版本升级、回滚及移动端交付文档维护。
---

# Anybox 移动端开发与发布

## 核心规则

- 从仓库根目录执行命令。
- 将 `packages/mobile-app/app.json` 作为 production 的版本、Android
  `versionCode`、仓库、标签前缀、更新端点和发布资产名称的唯一事实来源。
- 保持 `app.json` 只描述 production。日常 Android 开发通过受校验的
  development profile 派生 `com.anybox.mobile.dev`、`Anybox Mobile Dev`
  和 `anybox-mobile-dev`。
- 严格区分本地验证与外部发布。不得为了证明流程可行而修改 preview 或
  production。
- 发布 OTA 或 APK 前，要求源码已提交且任务范围内工作区干净。
- 发布原生 production 版本前，要求提供真实设备证据。
- 不得虚构截图、Smoke 结果或设备覆盖。
- 安装、清数据、替换或卸载应用前，必须确认 ADB 序列号、目标包、签名兼容性
  和数据丢失行为。

移动端 GitHub Release 必须使用以下独立身份：

- 标签以 `mobile-v` 开头，例如 `mobile-v0.3.1`。
- 资产包括 `anybox-mobile.apk`、`anybox-mobile-release.json` 和
  `anybox-mobile-release.json.sig`。
- 不得使用 `releases/latest` 发现移动端版本。
- 不得把移动端版本标记为 GitHub latest；使用 `--latest=false` 或
  `make_latest: "false"`。
- 移动端只筛选 `mobile-v*` Release。

## 必须遵守的生命周期

依次通过四道门禁：

1. 使用 Metro 或原生开发包完成本地开发。
2. 使用独立 APK 完成真实设备 Smoke。
3. 验证不可变 preview OTA 或正式签名原生候选包。
4. 完成 production 发布，并通过正常用户路径复验。

处理开发、测试、设备策略、发布分类、人工清单或无发布验证时，读取
`references/development-test-release.md`。

处理 GitHub 资产名称、Manifest 结构、命令格式、恢复、Windows 工具链或上传
故障时，读取 `references/github-mobile-release.md`。

## 门禁 1：低成本检查

在耗时的 Android 构建前执行：

```powershell
corepack pnpm mobile:doctor --strict
corepack pnpm mobile:typecheck
corepack pnpm --filter anybox-mobile-app exec expo install --check
```

运行与改动区域匹配的测试。涉及更新和发布工具时执行：

```powershell
corepack pnpm --filter anybox-mobile-app test:update-tools
```

仅修改页面、React 组件、样式、文案、翻译或普通 JavaScript/TypeScript 逻辑时，
优先使用 development 原生客户端连接 Metro：

```powershell
corepack pnpm mobile:android:dev -- --device <adb-serial>
```

保持 Metro 终端运行，保存源码后使用 Fast Refresh；未自动刷新时在 Metro 终端按
`r`。纯 UI 且不依赖 Anybox 自定义原生模块时，也可通过
`mobile:start -- --lan --port 8082` 使用 Expo Go。具体选择、连接、反馈时间和
退出 Metro 后的验收要求见 `references/development-test-release.md`。

需要与正式版并存、内嵌最新 JavaScript 的日常真机包时执行：

```powershell
corepack pnpm mobile:android:deploy:dev -- --serial <adb-serial>
```

该命令必须执行 typecheck、按目标 ABI 构建内嵌 JS 的 APK、校验
`com.anybox.mobile.dev`、只调用 `adb install -r`，并启动开发版。不得卸载或
清除应用数据；签名冲突时只能报告失败。开发版本地沙箱与正式版隔离，但仍可能
访问 production Provider/Relay；优先使用测试账号。

Fast Refresh 不能验证内嵌 bundle、停止 Metro 后启动、包身份或原生配置。结束一轮
页面或 JS 开发前，运行 typecheck、聚焦测试和一次 `mobile:android:deploy:dev`。
权限、原生依赖、Expo/React Native、config plugin、原生模块、`app.config.js`、
包身份、Scheme 或更新配置发生变化时，直接重新构建原生 development 客户端，不得
只用 Fast Refresh 验证。

## 门禁 2：独立交付验证

构建并检查 production 身份的独立 debug APK：

```powershell
corepack pnpm mobile:android:build:debug
corepack pnpm mobile:android:delivery-check -- --strict --no-manifest
```

Windows 上若 Ninja 报错
`manifest 'build.ninja' still dirty after 100 tries`，不得持续重试或替换原生
基线；按 `references/development-test-release.md` 中的短 pnpm virtual-store
流程处理。

存在兼容的真实设备时执行：

```powershell
$env:ANDROID_SERIAL = "<adb-serial>"
corepack pnpm mobile:android:install:debug
corepack pnpm mobile:android:smoke:debug
corepack pnpm mobile:android:smoke:pairing
corepack pnpm mobile:android:smoke:bridge -- --url "<配对 URL 或深链>"
```

注意：`android:smoke:debug` 默认清除应用数据，除非传入 `--keep-data`；
pairing Smoke 会有意从干净状态开始。

针对 development 安装执行真实 Bridge Smoke：

```powershell
corepack pnpm mobile:android:smoke:bridge:dev -- --url "<配对 URL 或深链>"
```

桌面端可能生成 production 的 `anybox-mobile:` 链接。development Smoke 必须在
通过 ADB 启动前将其改写为 `anybox-mobile-dev:`，并默认保留开发版数据。

## 门禁 3：选择 OTA 或 APK

执行：

```powershell
corepack pnpm mobile:fingerprint:check
```

- 先确认相同提交与冻结锁文件在两个不同检出路径中产生相同 fingerprint。
  路径相关的不一致属于工具缺陷，不代表原生代码发生变化。
- fingerprint 匹配时，JavaScript、UI、翻译、业务逻辑和 JavaScript 资产可走
  自托管 OTA preview 与 promotion。
- fingerprint 不匹配时发布新 APK，包括权限、原生依赖、Expo/React Native、
  原生模块、包身份、Scheme、签名、更新源或应用元数据变化。
- 不得绕过 fingerprint 不一致强制发布 OTA。
- fingerprint、OTA 导出和 release 构建必须显式强制 production profile，避免
  调用者环境污染正式产物。

## OTA 流程

只能先发布到 preview：

```powershell
corepack pnpm mobile:update:preview -- --message "更新说明"
```

在 preview 客户端验证命令输出的准确 `updateId`，随后只提升该不可变更新：

```powershell
corepack pnpm mobile:update:promote -- --update-id <update-id>
```

必要时回滚：

```powershell
corepack pnpm mobile:update:rollback -- --channel production --embedded
```

preview 按通道生效，不按设备隔离。除非更新服务器实现 allowlist 或带认证的设备
路由，否则不得把它描述为“仅一台设备可见”。

## 原生 APK 流程

原生发布前更新：

- `expo.version`
- 严格递增的 `expo.android.versionCode`
- `packages/mobile-app/package.json` 中的版本
- 需要保持移动端版本一致时更新 `expo.ios.buildNumber`

最终确定原生配置后记录基线：

```powershell
corepack pnpm mobile:fingerprint:record
```

构建并本地验证 production 候选包：

```powershell
corepack pnpm mobile:android:build:release -- --channel production
adb -s <serial> install -r packages/mobile-app/build/anybox-mobile-release.apk
```

候选包通过所有门禁后才能发布：

```powershell
corepack pnpm mobile:release:publish -- --notes "发布说明"
```

发布器必须先上传不可变资产，最后再修改固定 production 指针。上传大型 APK 时
使用足够长的超时。

## 候选包完整性

当前一键发布命令会在设备 Smoke 和上传前重新构建 APK。本地 GitHub 资产准备器
会签署调用者提供的 APK，但不能证明该 APK 来自当前提交。因此不得把“资产准备
成功”当作候选包来源证明。

若需要长时间人工验证上传文件的准确字节，说明以上限制，并优先实现两阶段记录：

```text
candidate：构建 + 签名 + 校验 + 记录 commit/hash/certificate/version/fingerprint
publish：重新校验并上传记录中的准确文件，不再重新构建
```

在命令真正实现并通过测试前，不得声称候选包命令已经存在。

## 完成标准

声明成功前必须：

- 报告源码提交及任务范围内的工作区状态；
- 按需报告 version、versionCode、runtime version、channel、package 和签名身份；
- 报告实际执行过的自动化、独立构建、真实设备、preview 和 production 门禁；
- 报告缺失的截图和跳过的设备门禁；
- 发布后核对全部 GitHub 与 CDN 资产；
- 使用 production 客户端的正常用户路径验证发现并应用更新。
