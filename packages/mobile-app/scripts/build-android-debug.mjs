import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
import {
  buildIdentityForProfile,
  choosePrebuildMode,
  createProfileStamp,
  readProfileStamp,
  resolveBuildProfile,
} from "./lib/android-development.mjs"

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const require = createRequire(import.meta.url)
const isWindows = process.platform === "win32"
const GRADLE_WRAPPER_TIMEOUT_MS = 600_000
const DEFAULT_APK_ARCHITECTURES = "arm64-v8a,armeabi-v7a"
const ALLOWED_ANDROID_ARCHITECTURES = new Set([
  "arm64-v8a",
  "armeabi-v7a",
  "x86",
  "x86_64",
])

function packageBin(name) {
  return path.join(packageRoot, "node_modules", ".bin", `${name}${isWindows ? ".CMD" : ""}`)
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? packageRoot,
    encoding: "utf8",
    env: process.env,
    shell: options.shell ?? (isWindows && /\.cmd$/i.test(command)),
    stdio: options.stdio ?? "inherit",
    windowsHide: true,
  })
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed`)
  }
}

function readCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? packageRoot,
    encoding: "utf8",
    env: process.env,
    shell: options.shell ?? (isWindows && /\.cmd$/i.test(command)),
    stdio: "pipe",
    windowsHide: true,
  })
  if (result.status !== 0) {
    if (result.stderr) process.stderr.write(result.stderr)
    if (result.stdout) process.stdout.write(result.stdout)
    throw new Error(`${command} ${args.join(" ")} failed`)
  }
  return result.stdout.trim()
}

function commandExists(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: isWindows && command.endsWith(".bat"),
    stdio: "pipe",
    windowsHide: true,
  })
  return result.status === 0
}

function requireAndroidEnvironment() {
  const sdkRoot = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT
  if (!commandExists("java", ["-version"])) {
    throw new Error("Java is required. Run: corepack pnpm mobile:android:setup -- --install --set-env")
  }
  if (!sdkRoot) {
    throw new Error("ANDROID_HOME or ANDROID_SDK_ROOT is required. Run: corepack pnpm mobile:android:setup -- --set-env")
  }
  if (!existsSync(path.join(sdkRoot, "platform-tools"))) {
    throw new Error("Android platform-tools are missing. Run: corepack pnpm mobile:android:setup -- --install-sdk")
  }
}

function readArgs(argv) {
  const profileIndex = argv.indexOf("--profile")
  const profileValue = profileIndex >= 0 ? argv[profileIndex + 1] : "production"
  if (profileIndex >= 0 && !profileValue) {
    throw new Error("--profile requires production or development.")
  }
  return {
    clean: argv.includes("--clean"),
    embedBundle: !argv.includes("--no-embed"),
    minify: argv.includes("--minify"),
    prepareOnly: argv.includes("--prepare-only"),
    profile: resolveBuildProfile(profileValue),
  }
}

function main() {
  const args = readArgs(process.argv.slice(2))
  const identity = buildIdentityForProfile(args.profile)
  process.env.ANYBOX_MOBILE_BUILD_PROFILE = args.profile
  requireAndroidEnvironment()

  const expo = packageBin("expo")
  if (!existsSync(expo)) {
    throw new Error("Expo CLI is not installed in packages/mobile-app.")
  }

  const androidDir = path.join(packageRoot, "android")
  const profileStampPath = path.join(androidDir, ".anybox-build-profile.json")
  const previousProfile = existsSync(profileStampPath)
    ? readProfileStamp(readFileSync(profileStampPath, "utf8"))
    : null
  const prebuildMode = choosePrebuildMode({
    androidDirectoryExists: existsSync(androidDir),
    cleanRequested: args.clean,
    previousProfile,
    requestedProfile: args.profile,
  })
  const prebuildArgs = ["prebuild", "--platform", "android", "--no-install"]
  if (prebuildMode.clean) prebuildArgs.push("--clean")
  console.log(
    `Android prebuild: ${prebuildMode.clean ? "clean" : "incremental"} (${prebuildMode.reason}).`,
  )
  run(expo, prebuildArgs)
  restorePackageScripts()
  writeFileSync(profileStampPath, createProfileStamp(args.profile), "utf8")

  extendGradleWrapperTimeout(androidDir)
  patchGradleRepositories(androidDir)
  patchReactNativeGradlePluginRepositories()
  patchExpoGradlePluginRepositories()
  patchExpoModulesCoreGradlePluginRepositories()
  patchExpoUpdatesGradlePluginRepositories()
  if (args.embedBundle) {
    embedDebugBundle(expo, androidDir, args.minify)
  } else {
    rmSync(
      path.join(androidDir, "app", "src", "main", "assets", "index.android.bundle"),
      { force: true },
    )
  }
  if (args.prepareOnly) {
    console.log(`Prepared ${args.profile} Android sources: ${androidDir}`)
    return
  }
  const gradle = path.join(androidDir, isWindows ? "gradlew.bat" : "gradlew")
  if (!existsSync(gradle)) {
    throw new Error("Android Gradle wrapper was not generated.")
  }

  const architectures = resolveApkArchitectures()
  run(
    gradle,
    [
      "--no-daemon",
      "--console=plain",
      "--max-workers=2",
      `-PreactNativeArchitectures=${architectures}`,
      "assembleDebug",
    ],
    { cwd: androidDir, shell: isWindows },
  )

  const apkPath = path.join(androidDir, "app", "build", "outputs", "apk", "debug", "app-debug.apk")
  if (!existsSync(apkPath)) {
    throw new Error(`Debug APK was not found at ${apkPath}`)
  }

  const outputPath = path.join(packageRoot, "build", identity.outputFileName)
  mkdirSync(path.dirname(outputPath), { recursive: true })
  copyFileSync(apkPath, outputPath)
  console.log(`${identity.appName} APK: ${outputPath}`)
  console.log(`Android build profile: ${args.profile}`)
  console.log(`Android package: ${identity.packageName}`)
  console.log(`Android architectures: ${architectures}`)
}

function resolveApkArchitectures() {
  const raw = process.env.ANYBOX_ANDROID_ARCHITECTURES?.trim() || DEFAULT_APK_ARCHITECTURES
  const architectures = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
  if (
    architectures.length === 0 ||
    new Set(architectures).size !== architectures.length ||
    architectures.some((value) => !ALLOWED_ANDROID_ARCHITECTURES.has(value))
  ) {
    throw new Error(
      "ANYBOX_ANDROID_ARCHITECTURES must be a unique comma-separated subset of " +
        [...ALLOWED_ANDROID_ARCHITECTURES].join(", ") +
        ".",
    )
  }
  return architectures.join(",")
}

function embedDebugBundle(expo, androidDir, minify) {
  const entryFile = readCommand("node", [
    "-e",
    "require('expo/scripts/resolveAppEntry')",
    packageRoot,
    "android",
    "absolute",
  ])
  const assetsDir = path.join(androidDir, "app", "src", "main", "assets")
  const resDir = path.join(androidDir, "app", "src", "main", "res")
  mkdirSync(assetsDir, { recursive: true })
  mkdirSync(resDir, { recursive: true })

  process.env.NODE_ENV = process.env.NODE_ENV || "production"
  run(expo, [
    "export:embed",
    "--entry-file",
    entryFile,
    "--platform",
    "android",
    "--dev",
    "false",
    "--minify",
    minify ? "true" : "false",
    "--bundle-output",
    path.join(assetsDir, "index.android.bundle"),
    "--assets-dest",
    resDir,
  ])
}

function patchReactNativeGradlePluginRepositories() {
  const reactNativePackagePath = require.resolve("react-native/package.json", {
    paths: [packageRoot],
  })
  const pluginPackagePath = require.resolve("@react-native/gradle-plugin/package.json", {
    paths: [reactNativePackagePath],
  })
  const pluginRoot = path.dirname(pluginPackagePath)

  const settingsPath = path.join(pluginRoot, "settings.gradle.kts")
  if (existsSync(settingsPath)) {
    const raw = readFileSync(settingsPath, "utf8")
    const current = normalizeAliyunPublic(raw)
    if (current !== raw) writeFileSync(settingsPath, current, "utf8")
    if (!current.includes("maven.aliyun.com/repository/gradle-plugin")) {
      writeFileSync(
        settingsPath,
        current.replace(
          "  repositories {\n    mavenCentral()\n    google()\n    gradlePluginPortal()\n  }",
          [
            "  repositories {",
            "    maven(\"https://maven.aliyun.com/repository/gradle-plugin\")",
            "    maven(\"https://maven.aliyun.com/repository/google\")",
            "    maven(\"https://maven.aliyun.com/repository/public\")",
            "    mavenCentral()",
            "    google()",
            "    gradlePluginPortal()",
            "  }",
          ].join("\n"),
        ),
        "utf8",
      )
    }
  }

  for (const relativePath of [
    "react-native-gradle-plugin/build.gradle.kts",
    "settings-plugin/build.gradle.kts",
    "shared/build.gradle.kts",
    "shared-testutil/build.gradle.kts",
  ]) {
    const filePath = path.join(pluginRoot, relativePath)
    if (!existsSync(filePath)) continue
    const raw = readFileSync(filePath, "utf8")
    const current = normalizeAliyunPublic(raw)
    if (current !== raw) writeFileSync(filePath, current, "utf8")
    if (current.includes("maven.aliyun.com/repository/public")) continue

    const expanded = [
      "repositories {",
      "  maven(\"https://maven.aliyun.com/repository/google\")",
      "  maven(\"https://maven.aliyun.com/repository/public\")",
      "  google()",
      "  mavenCentral()",
      "}",
    ].join("\n")

    const next = current
      .replace("repositories {\n  google()\n  mavenCentral()\n}", expanded)
      .replace("repositories { mavenCentral() }", expanded)

    writeFileSync(filePath, next, "utf8")
  }
}

function patchExpoGradlePluginRepositories() {
  const expoPackagePath = require.resolve("expo/package.json", {
    paths: [packageRoot],
  })
  const autolinkingPackagePath = require.resolve("expo-modules-autolinking/package.json", {
    paths: [expoPackagePath],
  })
  const pluginRoot = path.join(path.dirname(autolinkingPackagePath), "android", "expo-gradle-plugin")
  patchKotlinSettingsRepositories(path.join(pluginRoot, "settings.gradle.kts"))

  for (const relativePath of [
    "expo-autolinking-plugin/build.gradle.kts",
    "expo-autolinking-plugin-shared/build.gradle.kts",
    "expo-autolinking-settings-plugin/build.gradle.kts",
    "expo-max-sdk-override-plugin/build.gradle.kts",
  ]) {
    patchKotlinBuildRepositories(path.join(pluginRoot, relativePath))
  }
}

function patchExpoModulesCoreGradlePluginRepositories() {
  const expoPackagePath = require.resolve("expo/package.json", {
    paths: [packageRoot],
  })
  const modulesCorePackagePath = require.resolve("expo-modules-core/package.json", {
    paths: [expoPackagePath],
  })
  const pluginRoot = path.join(path.dirname(modulesCorePackagePath), "expo-module-gradle-plugin")

  ensureKotlinSettingsRepositories(
    path.join(pluginRoot, "settings.gradle.kts"),
    "expo-module-gradle-plugin",
  )
  patchKotlinBuildRepositories(path.join(pluginRoot, "build.gradle.kts"))
}

function patchExpoUpdatesGradlePluginRepositories() {
  const expoUpdatesPackagePath = require.resolve("expo-updates/package.json", {
    paths: [packageRoot],
  })
  const pluginRoot = path.join(path.dirname(expoUpdatesPackagePath), "expo-updates-gradle-plugin")

  patchKotlinBuildRepositories(path.join(pluginRoot, "build.gradle.kts"))
}

function ensureKotlinSettingsRepositories(settingsPath, rootProjectName) {
  if (existsSync(settingsPath)) {
    patchKotlinSettingsRepositories(settingsPath)
    return
  }

  writeFileSync(
    settingsPath,
    [
      "pluginManagement {",
      "  repositories {",
      '    maven("https://maven.aliyun.com/repository/gradle-plugin")',
      '    maven("https://maven.aliyun.com/repository/google")',
      '    maven("https://maven.aliyun.com/repository/public")',
      "    mavenCentral()",
      "    google()",
      "    gradlePluginPortal()",
      "  }",
      "}",
      "",
      `rootProject.name = "${rootProjectName}"`,
      "",
    ].join("\n"),
    "utf8",
  )
}

function patchKotlinSettingsRepositories(settingsPath) {
  if (!existsSync(settingsPath)) return
  const raw = readFileSync(settingsPath, "utf8")
  const current = normalizeAliyunPublic(raw)
  if (current !== raw) writeFileSync(settingsPath, current, "utf8")
  if (current.includes("maven.aliyun.com/repository/gradle-plugin")) return

  writeFileSync(
    settingsPath,
    current.replace(
      "  repositories {\n    mavenCentral()\n    google()\n    gradlePluginPortal()\n  }",
      [
        "  repositories {",
        "    maven(\"https://maven.aliyun.com/repository/gradle-plugin\")",
        "    maven(\"https://maven.aliyun.com/repository/google\")",
        "    maven(\"https://maven.aliyun.com/repository/public\")",
        "    mavenCentral()",
        "    google()",
        "    gradlePluginPortal()",
        "  }",
      ].join("\n"),
    ),
    "utf8",
  )
}

function patchKotlinBuildRepositories(filePath) {
  if (!existsSync(filePath)) return
  const raw = readFileSync(filePath, "utf8")
  const current = normalizeAliyunPublic(raw)
  if (current !== raw) writeFileSync(filePath, current, "utf8")
  if (current.includes("maven.aliyun.com/repository/public")) return

  const expanded = [
    "repositories {",
    "  maven(\"https://maven.aliyun.com/repository/google\")",
    "  maven(\"https://maven.aliyun.com/repository/public\")",
    "  google()",
    "  mavenCentral()",
    "}",
  ].join("\n")

  const next = current
    .replace("repositories {\n  google()\n  mavenCentral()\n}", expanded)
    .replace("repositories {\n  mavenCentral()\n}", expanded)

  writeFileSync(filePath, next, "utf8")
}

function restorePackageScripts() {
  const packagePath = path.join(packageRoot, "package.json")
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8"))
  packageJson.scripts = {
    ...packageJson.scripts,
    android: "expo start --android",
    "android:dev": "expo run:android",
  }
  writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8")
}

function extendGradleWrapperTimeout(androidDir) {
  const propertiesPath = path.join(androidDir, "gradle", "wrapper", "gradle-wrapper.properties")
  if (!existsSync(propertiesPath)) return

  const current = readFileSync(propertiesPath, "utf8")
  const next = current.includes("networkTimeout=")
    ? current.replace(/^networkTimeout=.*$/m, `networkTimeout=${GRADLE_WRAPPER_TIMEOUT_MS}`)
    : `${current.trimEnd()}\nnetworkTimeout=${GRADLE_WRAPPER_TIMEOUT_MS}\n`

  if (next !== current) {
    writeFileSync(propertiesPath, next, "utf8")
  }
}

function patchGradleRepositories(androidDir) {
  const settingsPath = path.join(androidDir, "settings.gradle")
  if (existsSync(settingsPath)) {
    const raw = readFileSync(settingsPath, "utf8")
    const current = normalizeAliyunPublic(raw)
    if (current !== raw) writeFileSync(settingsPath, current, "utf8")
    if (!current.includes("maven.aliyun.com/repository/gradle-plugin")) {
      writeFileSync(
        settingsPath,
        current.replace(
          "pluginManagement {\n",
          [
            "pluginManagement {",
            "  repositories {",
            "    maven { url 'https://maven.aliyun.com/repository/gradle-plugin' }",
            "    maven { url 'https://maven.aliyun.com/repository/google' }",
            "    maven { url 'https://maven.aliyun.com/repository/public' }",
            "    google()",
            "    mavenCentral()",
            "    gradlePluginPortal()",
            "  }",
          ].join("\n") + "\n",
        ),
        "utf8",
      )
    }
  }

  const buildPath = path.join(androidDir, "build.gradle")
  if (existsSync(buildPath)) {
    const raw = readFileSync(buildPath, "utf8")
    const current = normalizeAliyunPublic(raw)
    if (current !== raw) writeFileSync(buildPath, current, "utf8")
    if (current.includes("maven.aliyun.com/repository/google")) return

    const next = current
      .replace(
        "  repositories {\n    google()\n    mavenCentral()\n  }",
        [
          "  repositories {",
          "    maven { url 'https://maven.aliyun.com/repository/google' }",
          "    maven { url 'https://maven.aliyun.com/repository/public' }",
          "    google()",
          "    mavenCentral()",
          "  }",
        ].join("\n"),
      )
      .replace(
        "  repositories {\n    google()\n    mavenCentral()\n    maven { url 'https://www.jitpack.io' }\n  }",
        [
          "  repositories {",
          "    maven { url 'https://maven.aliyun.com/repository/google' }",
          "    maven { url 'https://maven.aliyun.com/repository/public' }",
          "    google()",
          "    mavenCentral()",
          "    maven { url 'https://www.jitpack.io' }",
          "  }",
        ].join("\n"),
      )

    writeFileSync(buildPath, next, "utf8")
  }
}

function normalizeAliyunPublic(value) {
  return value.replaceAll("https://maven.aliyun.com/repository/maven-public", "https://maven.aliyun.com/repository/public")
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
