# Anybox 移动端开发、测试与发布

## 目录

1. 运行模型
2. 安全边界
3. 门禁 1：本地开发
4. 门禁 2：Android 独立包验证
5. 门禁 3：变更分类
6. OTA preview 与 production
7. 原生 APK 候选包与 production
8. 发布后验证
9. 设备策略
10. 人工真机清单
11. 不发布情况下验证流程
12. 已知流程缺口

## 运行模型

使用三个环境和四道门禁：

```text
本地源码
  -> 本地开发
  -> 独立包真实设备验证
  -> preview 或正式签名原生候选包
  -> production 发布
  -> production 正常路径复验
```

不要把“安装多少个应用”作为流程基础。独立 development application ID 适用于个人
手机必须保留正式版的场景；专用真实测试机仍能最准确地验证包名、Scheme、签名和
升级行为。

使用测试 Provider 账号、staging Provider 或仅连接开发者自己的桌面 Bridge。独立
应用沙箱只隔离手机本地数据，不能阻止开发客户端修改 production 服务端数据。

## 安全边界

将以下命令视为仅本地操作：

```powershell
corepack pnpm mobile:start
corepack pnpm mobile:android:dev
corepack pnpm mobile:android:build:dev
corepack pnpm mobile:android:deploy:dev
corepack pnpm mobile:android:build:debug
corepack pnpm mobile:android:build:release
corepack pnpm mobile:android:install:debug
corepack pnpm mobile:android:delivery-check
corepack pnpm mobile:fingerprint:check
corepack pnpm mobile:release:github:prepare
```

将以下命令视为外部发布操作：

```powershell
corepack pnpm mobile:update:preview
corepack pnpm mobile:update:promote
corepack pnpm mobile:update:rollback
corepack pnpm mobile:release:publish
gh release create
gh release upload
```

仅验证可行性时不得执行外部发布命令。修改 preview 或 production 前必须取得明确
授权。

卸载应用、清除数据、替换已配对桌面端或向个人设备安装不同构建前，必须先确认
包名、签名兼容性、目标序列号和数据丢失行为。

## 门禁 1：本地开发

在功能分支工作。普通本地开发不得提升 production 版本。

先执行环境与低成本检查：

```powershell
corepack pnpm mobile:doctor --strict
corepack pnpm mobile:typecheck
corepack pnpm --filter anybox-mobile-app exec expo install --check
```

### 页面与 JavaScript 快速验证

仅修改页面、React 组件、样式、文案、翻译或普通 JavaScript/TypeScript 业务逻辑
时，优先使用真实手机上的 development 原生客户端连接 Metro：

```powershell
corepack pnpm mobile:android:dev -- --device <adb-serial>
```

首次执行会准备并覆盖安装 `com.anybox.mobile.dev` 原生客户端，然后启动 Metro。
保持该终端运行；保存源码后让 Fast Refresh 更新手机。正常增量反馈通常为秒级，
可把 1～3 秒作为经验预期，但必须报告实测结果，不能将其作为成功保证。未自动刷新
时，在 Metro 终端按 `r`；若页面状态阻止刷新，先重新加载应用，不要为刷新而卸载
或清除开发版数据。

只有纯 UI/JavaScript 路径不依赖 Anybox 自定义原生模块时，才使用 Expo Go 快速
预览：

```powershell
corepack pnpm mobile:start -- --lan --port 8082
```

让手机与电脑位于可互通的局域网，并用 Expo Go 扫描 Metro 二维码。Expo Go 不能
证明自定义原生模块、包身份、Scheme、签名或原生配置正确；相关流程优先使用
`mobile:android:dev`。

停止 Metro 后，Metro 驱动的客户端不能继续加载最新开发代码。结束一轮快速开发前，
运行低成本检查、与改动匹配的测试，并重新生成内嵌最新 JavaScript 的独立 APK：

```powershell
corepack pnpm mobile:typecheck
corepack pnpm mobile:android:deploy:dev -- --serial <adb-serial>
```

部署命令会再次执行 typecheck、保留开发版数据、覆盖安装并启动应用。完成后停止
Metro，再次启动开发版，验证内嵌 bundle 确实可独立运行。Metro 验证成功不是独立
APK 或发布门禁的替代品。

修改权限、原生依赖、Expo SDK、React Native、config plugin、原生模块、
`app.config.js`、包身份、Scheme、签名或更新配置时，不要只使用 Fast Refresh；
重新运行 `mobile:android:dev` 构建原生 development 客户端，最终仍执行独立 APK
验收。

需要只构建内嵌最新 JavaScript、停止 Metro 后仍可独立启动的 APK 时执行：

```powershell
corepack pnpm mobile:android:build:dev
```

日常真实手机循环使用：

```powershell
corepack pnpm mobile:android:deploy:dev -- --serial <adb-serial>
```

设备解析顺序为 `--serial`、`ANDROID_SERIAL`、唯一在线且已授权的设备。部署器会
执行 typecheck、选择目标 ABI、校验 development APK 身份、只调用
`adb install -r`，随后启动应用。不得卸载或清数据；证书冲突时停止并报告。

被忽略的 `android/` 工程会记录上次构建 profile。首次构建、传入 `--clean` 或
production/development 切换时执行 clean prebuild；连续 development 部署保留
Gradle 缓存。development 与正式包拥有独立 Android 沙箱、SecureStore、登录、
配对和缓存，但仍可能指向同一 Provider/Relay；连接真实服务时使用测试账号。

production 身份的 debug 包和 production release 都使用 `com.anybox.mobile`，但
通常采用不同签名。不得把 `anybox-mobile-debug.apk` 覆盖安装到正式签名的个人
应用上。即使日常开发使用独立包名，原生发布仍必须完成 production 签名升级测试，
因为包身份、签名、深链、更新器和数据迁移行为不同。

Metro 成功不是发布门禁。分类或发布前必须继续验证独立 APK。

## 门禁 2：Android 独立包验证

运行与改动代码匹配的测试。涉及更新工具链时执行：

```powershell
corepack pnpm --filter anybox-mobile-app test:update-tools
```

development profile、部署工具和双 Scheme 测试统一执行：

```powershell
corepack pnpm mobile:test:dev
```

构建 production 身份的独立 debug APK：

```powershell
corepack pnpm mobile:android:build:debug
```

预期产物：

```text
packages/mobile-app/build/anybox-mobile-debug.apk
```

### Windows 原生构建路径

pnpm 默认隔离依赖路径可能使 Prefab 与 CMake 输入接近 Windows 路径上限，典型错误
如下：

```text
ninja: error: manifest 'build.ninja' still dirty after 100 tries
```

出现该错误时，保留冻结锁文件，并为当前 worktree 使用独立的短 virtual store。
不得在多个活动 worktree 之间共享同一个 virtual store：

```powershell
$anyboxVirtualStore = "C:\pvs\m"
corepack pnpm --config.virtual-store-dir=$anyboxVirtualStore install --filter anybox-mobile-app... --frozen-lockfile --force
$env:ANYBOX_ANDROID_ARCHITECTURES = "arm64-v8a"
corepack pnpm mobile:android:build:debug -- --clean
```

短 virtual store 只能改变本地依赖布局，不得修改 `package.json` 或
`pnpm-lock.yaml`。完成后立即检查 `git status`。每个 worktree 使用不同短目录。
有效构建必须明确报告 `BUILD SUCCESSFUL` 并生成目标 APK；只把 Git 检出目录改短
不能作为成功证据。

安装前选择准确设备：

```powershell
$env:ANDROID_SERIAL = "<adb-serial>"
adb devices -l
```

只有在签名兼容且数据影响可接受时才能安装：

```powershell
corepack pnpm mobile:android:install:debug
```

替换已有安装前比较设备 APK 与候选包证书：

```powershell
$installedApk = (adb -s <serial> shell pm path com.anybox.mobile).Trim() -replace "^package:", ""
adb -s <serial> pull $installedApk packages/mobile-app/build/device-installed.apk
$apksigner = "$env:LOCALAPPDATA\Android\Sdk\build-tools\36.0.0\apksigner.bat"
& $apksigner verify --print-certs packages/mobile-app/build/device-installed.apk
& $apksigner verify --print-certs packages/mobile-app/build/anybox-mobile-debug.apk
```

相同包名但证书摘要不同，表示 Android 无法原地升级。手机上的 USB 安装确认不能
绕过此规则；不得为了让命令成功而卸载或清数据。

执行本地检查：

```powershell
corepack pnpm mobile:android:smoke:debug
corepack pnpm mobile:android:smoke:pairing
corepack pnpm mobile:android:smoke:bridge -- --url "<配对 URL 或深链>"
corepack pnpm mobile:android:smoke:bridge:dev -- --url "<配对 URL 或深链>"
corepack pnpm mobile:android:delivery-check -- --strict --no-manifest
```

`android:smoke:debug` 默认清数据，除非传入 `--keep-data`。
`android:smoke:pairing` 会有意从干净应用状态开始，因此只在专用测试安装上运行。
development Bridge Smoke 默认保留数据，并在启动 development 包前将桌面端生成的
`anybox-mobile:` 改写为 `anybox-mobile-dev:`。

当前启动 Smoke 只识别英文 `Connect` 和 `Account` 页面。本地化客户端或恢复到
Updates 等嵌套路由时，健康启动可能被误判为失败。在脚本改用稳定 test ID 或与语言
无关的资源 ID 前，使用其支持的语言和起始路由，或者明确记录人工启动检查、进程
检查、fatal 日志检查和截图。不得把人工证据声称为自动化通过。

没有实际安装或 Smoke 时，不得虚构截图或真实设备覆盖。

## 门禁 3：变更分类

执行：

```powershell
corepack pnpm mobile:fingerprint:check
```

信任结果前必须验证可移植性：相同提交、锁文件、包管理器版本和原生输入应在两个
不同检出路径中产生相同哈希。若不同，fingerprint 源仍包含环境路径或自动链接输出。
此时阻止 OTA 分类，临时使用固定规范发布工作区，并优先修复归一化。

不得仅为消除不一致而执行 `mobile:fingerprint:record -- --replace`。只有以下情况
可以替换基线：

- 已评审的原生变更，并同步提升 APK 版本；
- 已评审的 fingerprint 归一化修复，且跨 worktree 测试通过。

仅在原生 fingerprint 与记录基线一致时使用 OTA。典型 OTA 安全变更包括 React
代码、样式、翻译、业务逻辑和 JavaScript 资产。

当 fingerprint 改变，或改动涉及权限、原生依赖、Expo/React Native、原生模块、
包身份、Scheme、签名、更新源或应用元数据时，发布新 APK。

无法确定时选择 APK，不得绕过 fingerprint 不一致强制发布 OTA。

## OTA preview 与 production

从已提交、任务范围内干净的源码开始。

确保真实测试客户端订阅 `preview`。可以先在本地构建并安装 production 签名的
preview 外壳，而不发布 OTA：

```powershell
corepack pnpm mobile:android:build:release -- --channel preview
adb -s <serial> install -r packages/mobile-app/build/anybox-mobile-release.apk
```

该 APK 使用与正式版相同包名，会替换已有安装；必须先确认签名和设备数据影响。

将不可变 OTA 发布到 preview：

```powershell
corepack pnpm mobile:update:preview -- --message "描述更新"
```

记录输出的 `updateId`。在 preview 设备验证准确 `updateId`、冷启动、前后台切换、
网络和受影响产品流程。

只提升已经验证的不可变更新：

```powershell
corepack pnpm mobile:update:promote -- --update-id <update-id>
```

preview 与 promotion 之间不得重新构建。promotion 只移动通道指针。

紧急回滚：

```powershell
corepack pnpm mobile:update:rollback -- --channel production --embedded
```

preview 按通道生效，会影响所有订阅 preview 的兼容客户端。严格单设备 preview
需要服务端 allowlist 或带认证的设备级路由。

## 原生 APK 候选包与 production

原生发布前更新：

- `packages/mobile-app/app.json` 中的 `expo.version`
- `packages/mobile-app/app.json` 中的 `expo.android.versionCode`
- `packages/mobile-app/package.json` 中的 `version`
- 需要保持移动端版本一致时更新 `expo.ios.buildNumber`

Android `versionCode` 必须严格递增。

原生配置最终确定后记录兼容基线：

```powershell
corepack pnpm mobile:fingerprint:record
```

本地构建 production 签名候选包：

```powershell
corepack pnpm mobile:android:build:release -- --channel production
```

在真实设备上覆盖安装，并验证数据保留、冷启动、权限、配对、认证和更新器：

```powershell
adb -s <serial> install -r packages/mobile-app/build/anybox-mobile-release.apk
```

一键 production 流程：

```powershell
corepack pnpm mobile:release:publish -- --notes "发布说明"
```

该命令要求干净源码和真实设备，会构建 production APK、运行设备 Smoke、创建
`mobile-v*` GitHub Release、上传不可变 GitHub/CDN 资产，并最后修改固定
production 指针。

不得把移动端 GitHub Release 标记为 latest，也不得通过 `releases/latest`
发现移动端更新。

只验证本地 GitHub 资产准备流程时执行：

```powershell
corepack pnpm mobile:release:github:prepare -- `
  --apk packages/mobile-app/build/anybox-mobile-release.apk `
  --out-dir packages/mobile-app/build/github-release-feasibility `
  --notes "仅本地验证"
```

该命令必须生成 `anybox-mobile.apk`、`anybox-mobile-release.json` 和
`anybox-mobile-release.json.sig`。在本地核对 Manifest 中的 APK 哈希和分离签名。
未明确授权发布时，不得执行命令输出的 `gh release create`。

资产准备只能证明 Manifest 构造与签名，不能证明 APK 来自当前提交。把产物视为
候选包前，必须独立验证 APK 新鲜度、源码提交、版本、证书、原生 fingerprint 和
字节身份。

## 发布后验证

使用 production 通道客户端走正常用户路径：

- 发现 OTA 或 APK；
- 验证签名 Manifest；
- 通过公开 CDN 或 GitHub fallback 下载；
- 安装或重新加载；
- 核对版本、构建号、update ID 和数据保留；
- 重复关键产品流程；
- 检查更新诊断和 Android fatal 日志。

OTA 可以回退到内嵌 bundle。原生 APK 不能通过降低 `versionCode` 安全回滚，必须
发布更高版本号的修复 APK。

## 设备策略

优先顺序：

1. 使用 production 包身份的专用真实 Android 测试机，获得最高保真度；
2. 在个人手机并存独立 development 包完成日常迭代，最后通过 production 签名
   候选包门禁；
3. 使用 Expo Go 快速反馈 JavaScript，随后补充独立包和签名真机门禁。

development 包提供运行隔离，但不能证明 production 包名、Scheme、签名、自更新
或升级路径正确。

## 人工真机清单

至少验证：

- 首次安装、冷启动、force-stop 和重启；
- 覆盖上一正式版并保留数据；
- 注册、登录、token 刷新和退出；
- 相机权限、扫码、粘贴链接和深链；
- Relay 与局域网配对；
- 离线、重连、后台和前台切换；
- 工作区、聊天、流式消息、任务、审批和文件；
- 更新检查、OTA reload、APK 下载和未知来源安装权限；
- 版本、包名、通道、update ID 和诊断显示；
- Android fatal 日志。

## 不发布情况下验证流程

依次执行：

1. 检查 `git status`、移动端配置、版本和已连接设备。
2. 运行 doctor、typecheck、Expo 依赖检查和聚焦测试。
3. 运行 `mobile:fingerprint:check`。若意外失败，先在另一检出路径重复同一提交，
   再分类变更；不得直接替换基线。
4. 使用 `--no-manifest` 运行 delivery check，暴露陈旧或缺失证据。
5. 重新构建 debug APK。Windows 上 Ninja 反复生成 `build.ninja` 时，为当前
   worktree 使用独立短 pnpm virtual store。
6. 再次运行 delivery check。
7. 安装前比较设备与候选包的包名、版本和签名证书。
8. 只有目标设备和数据影响可接受时才安装并执行 Smoke。
9. 通过测试和源码检查验证 preview/production 发布器保护。本地 GitHub 资产准备
   可以执行；不得仅为证明命令存在而发布到外部。
10. 明确报告所有跳过的真实设备和外部发布门禁。

## 已知流程缺口

`mobile:release:publish` 会在设备 Smoke 与发布前重新构建 APK，因此单独长时间人工
测试过的 APK 不保证与稍后上传文件字节一致。

`mobile:release:github:prepare` 接受调用者提供的 APK，但没有源码提交证明。只完成
该步骤不能证明候选包完整性。

需要长时间验证候选包时，实现两阶段流程：

```text
mobile:release:candidate
  -> 构建、签名、验证并记录 commit/hash/certificate/version/fingerprint

mobile:release:publish -- --candidate <record>
  -> 重新验证并上传记录中的准确文件，不再重新构建
```

在命令真正实现并测试前，不得声称它已经存在。

启动 Smoke 还需要与语言无关的就绪选择器和确定性起始路由。在此之前，本地化界面
或恢复的嵌套路由必须明确标记为人工验证证据。
