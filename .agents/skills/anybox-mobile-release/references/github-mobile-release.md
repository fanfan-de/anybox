# GitHub 移动端发布参考

## 仓库约定

- 仓库：读取 `packages/mobile-app/app.json` 中的
  `expo.extra.anyboxMobileGitHubRepository`，当前为 `fanfan-de/anybox`
- 移动端目录：`packages/mobile-app`
- 默认 APK 输入：`packages/mobile-app/build/anybox-mobile-release.apk`
- 生成的发布资产目录：`packages/mobile-app/build/github-release`
- Release 标签前缀：`mobile-v`
- APK 资产名：`anybox-mobile.apk`
- Manifest 资产名：`anybox-mobile-release.json`
- Manifest 签名资产名：`anybox-mobile-release.json.sig`

## Manifest 结构

`anybox-mobile-release.json` 应包含：

```json
{
  "version": "0.2.0",
  "versionCode": 2,
  "minimumVersionCode": 1,
  "apkUrl": "https://github.com/fanfan-de/anybox/releases/download/mobile-v0.2.0/anybox-mobile.apk",
  "sha256": "optional-sha256",
  "sizeBytes": 123456789,
  "notes": ["修复配对稳定性"],
  "force": false
}
```

规则：

- `version` 必须与 `expo.version` 一致。
- `versionCode` 必须与 `expo.android.versionCode` 一致。
- 每个 Android 原生版本的 `versionCode` 必须递增。
- 设置 `minimumVersionCode` 或 `force: true` 会把更新标记为强制更新。
- `apkUrl` 必须指向同一个 `mobile-v*` Release，不得使用
  `releases/latest`。

## 命令

从仓库根目录执行：

```powershell
corepack pnpm mobile:android:delivery-check -- --strict --no-manifest
corepack pnpm mobile:android:build:release -- --channel production
corepack pnpm mobile:release:github:prepare -- --notes "修复配对稳定性"
```

prepare 命令会输出类似以下发布命令：

```powershell
gh release create mobile-v0.2.0 "packages/mobile-app/build/github-release/anybox-mobile.apk" "packages/mobile-app/build/github-release/anybox-mobile-release.json" "packages/mobile-app/build/github-release/anybox-mobile-release.json.sig" --repo fanfan-de/anybox --title "Anybox Mobile 0.2.0" --notes "Anybox Mobile 0.2.0" --latest=false
```

上传大型 APK 时使用足够长的超时。若 `gh release create` 超时，先检查是否已创建
草稿：

```powershell
gh release view mobile-v0.2.0 --repo fanfan-de/anybox --json tagName,isDraft,assets,url
```

草稿存在但缺少资产时，只补传缺失资产，再发布草稿：

```powershell
gh release upload mobile-v0.2.0 "packages/mobile-app/build/github-release/anybox-mobile.apk" --repo fanfan-de/anybox --clobber
gh release edit mobile-v0.2.0 --repo fanfan-de/anybox --draft=false
```

只有确实需要强制用户更新时，才给 prepare 命令传入 `--force`：

```powershell
corepack pnpm mobile:release:github:prepare -- --notes "必须安装的更新" --force --minimum-version-code 2
```

## 验证

交付前执行：

```powershell
corepack pnpm --filter anybox-mobile-app typecheck
corepack pnpm --filter anybox-mobile-app exec expo install --check
```

存在真实设备时补充：

```powershell
corepack pnpm mobile:android:smoke:debug
corepack pnpm mobile:android:smoke:pairing
```

## Windows 构建快速配置

在本地 Windows 工作站执行 Android 构建前设置：

```powershell
$env:JAVA_HOME="$env:LOCALAPPDATA\AnyboxMobile\AndroidToolchain\jdk-17"
$env:ANDROID_HOME="$env:LOCALAPPDATA\Android\Sdk"
$env:ANDROID_SDK_ROOT=$env:ANDROID_HOME
$env:ANDROID_NDK_HOME="$env:ANDROID_HOME\ndk\27.1.12297006"
$env:ANDROID_NDK_ROOT=$env:ANDROID_NDK_HOME
$env:PATH="$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\cmdline-tools\latest\bin;$env:PATH"
```

若 `corepack pnpm mobile:android:build:debug` 在 prebuild 后停滞，但
`android/app/src/main/assets/index.android.bundle` 已存在，可直接继续 Gradle：

```powershell
cd packages/mobile-app/android
.\gradlew.bat --no-daemon --console=plain assembleDebug
cd ..\..\..
Copy-Item packages/mobile-app/android/app/build/outputs/apk/debug/app-debug.apk packages/mobile-app/build/anybox-mobile-debug.apk -Force
```

## 故障排查

- 应用找不到 Release：确认标签以 `mobile-v` 开头，且 Release 不是草稿。
- Release 是 prerelease：除非应用配置允许检查 prerelease，否则会被忽略。
- 应用找到 Release 但无法下载：确认资产名为 `anybox-mobile.apk`。
- 应用拒绝 Manifest：确认 `anybox-mobile-release.json.sig` 存在，且由完全相同的
  Manifest 字节生成。
- 桌面端 Release 干扰移动端：确认任何移动端代码路径都没有使用
  `releases/latest`。
- Gradle 报错 `Could not resolve com.android.tools.build:gradle:8.5.0`：确认
  `packages/mobile-app/scripts/build-android-debug.mjs` 除 Expo 和 React Native
  Gradle plugin 外，也修补了 `expo-updates-gradle-plugin/build.gradle.kts`
  的仓库配置。
- Gradle 报错 `[CXX1101] NDK ... did not have a source.properties file`：
  列出 `"$env:LOCALAPPDATA\Android\Sdk\ndk"`，将安装未完成的 NDK 目录移出
  `ndk` 后再构建。
