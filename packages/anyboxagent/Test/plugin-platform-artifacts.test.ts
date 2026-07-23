import { afterEach, describe, expect, test } from "bun:test"
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  PluginPlatformArtifact,
  installPlatformArtifacts,
  removePlatformArtifacts,
  retryPendingPlatformArtifactCleanup,
} from "../src/plugin/platform-artifacts.ts"
import { PluginManifest } from "../src/plugin/plugin.ts"

const roots: string[] = []

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "anybox-platform-artifact-"))
  roots.push(root)
  const packageRoot = path.join(root, "package")
  const executablePath = path.join(packageRoot, "bin", "extension-host")
  await mkdir(path.dirname(executablePath), { recursive: true })
  await writeFile(executablePath, "native-host-v1")
  return {
    root,
    packageRoot,
    executablePath,
    homeDir: path.join(root, "home"),
    dataDir: path.join(root, "data"),
    stateDir: path.join(root, "state"),
    env: {
      XDG_CONFIG_HOME: path.join(root, "config"),
    },
  }
}

function artifact() {
  return PluginPlatformArtifact.parse({
    id: "chrome-native-host",
    type: "chrome-native-messaging-host",
    hostName: "com.anybox.browser",
    description: "Anybox Chrome Native Messaging Host",
    extensionIDs: ["hjbejdmgpifdjjlpgmdfmbmbhkedgnjc"],
    executables: [{
      platform: "linux",
      architecture: "x64",
      path: "bin/extension-host",
    }],
    runtimeConfig: {
      kind: "anybox-browser-ipc",
    },
  })
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true })
    ),
  )
})

describe("declarative plugin platform artifacts", () => {
  test("strictly validates native-host declarations", () => {
    expect(PluginManifest.safeParse({
      name: "native-test",
      version: "1.0.0",
      description: "Native test plugin.",
      platformArtifacts: [artifact()],
    }).success).toBe(true)
    expect(PluginPlatformArtifact.safeParse({
      ...artifact(),
      executables: [{
        platform: "linux",
        architecture: "x64",
        path: "../outside",
      }],
    }).success).toBe(false)
    expect(PluginPlatformArtifact.safeParse({
      ...artifact(),
      uninstallScript: "third-party-command",
    }).success).toBe(false)
  })

  test("installs, upgrades, and removes only ownership-proven resources", async () => {
    const input = await fixture()
    const [first] = await installPlatformArtifacts({
      pluginID: "chrome",
      pluginVersion: "0.10.0",
      packageRoot: input.packageRoot,
      artifacts: [artifact()],
      platform: "linux",
      architecture: "x64",
      homeDir: input.homeDir,
      dataDir: input.dataDir,
      stateDir: input.stateDir,
      env: input.env,
      now: () => 1_700_000_000_000,
    })
    expect(first).toBeDefined()
    expect(await readFile(first!.executablePath, "utf8")).toBe("native-host-v1")
    expect(JSON.parse(await readFile(first!.manifestPaths[0]!, "utf8")))
      .toMatchObject({
        name: "com.anybox.browser",
        path: first!.executablePath,
      })
    expect(JSON.parse(await readFile(first!.runtimeConfigPath!, "utf8")))
      .toMatchObject({
        ownershipID: first!.ownershipID,
        protocolVersion: 1,
        transport: "unix-domain-socket",
      })

    await writeFile(input.executablePath, "native-host-v2")
    const [second] = await installPlatformArtifacts({
      pluginID: "chrome",
      pluginVersion: "0.10.1",
      packageRoot: input.packageRoot,
      artifacts: [artifact()],
      existingReceipts: [first!],
      platform: "linux",
      architecture: "x64",
      homeDir: input.homeDir,
      dataDir: input.dataDir,
      stateDir: input.stateDir,
      env: input.env,
      now: () => 1_700_000_001_000,
    })
    expect(second!.ownershipID).toBe(first!.ownershipID)
    expect(await readFile(second!.executablePath, "utf8")).toBe("native-host-v2")

    await expect(removePlatformArtifacts({
      pluginID: "chrome",
      receipts: [second!],
      dataDir: input.dataDir,
    })).resolves.toEqual({
      removed: ["chrome-native-host"],
      skipped: [],
      pending: [],
    })
    await expect(access(second!.managedRoot)).rejects.toBeDefined()
    await expect(access(second!.manifestPaths[0]!)).rejects.toBeDefined()
    await expect(access(second!.runtimeConfigPath!)).rejects.toBeDefined()
  })

  test("installs, reinstalls, and uninstalls the macOS Native Messaging Host", async () => {
    const input = await fixture()
    const macArtifact = PluginPlatformArtifact.parse({
      ...artifact(),
      executables: [{
        platform: "darwin",
        architecture: "arm64",
        path: "bin/extension-host",
      }],
    })
    const installInput = {
      pluginID: "chrome",
      pluginVersion: "0.15.1",
      packageRoot: input.packageRoot,
      artifacts: [macArtifact],
      platform: "darwin" as const,
      architecture: "arm64" as const,
      homeDir: input.homeDir,
      dataDir: input.dataDir,
      stateDir: input.stateDir,
      env: {},
      now: () => 1_700_000_000_000,
    }

    const [first] = await installPlatformArtifacts(installInput)
    expect(first).toBeDefined()
    expect(first!.manifestPaths).toEqual([path.join(
      input.homeDir,
      "Library",
      "Application Support",
      "Google",
      "Chrome",
      "NativeMessagingHosts",
      "com.anybox.browser.json",
    )])
    expect(JSON.parse(await readFile(first!.manifestPaths[0]!, "utf8")))
      .toMatchObject({
        allowed_origins: [
          "chrome-extension://hjbejdmgpifdjjlpgmdfmbmbhkedgnjc/",
        ],
        name: "com.anybox.browser",
        path: first!.executablePath,
        type: "stdio",
      })
    const runtimeConfig = JSON.parse(
      await readFile(first!.runtimeConfigPath!, "utf8"),
    )
    expect(runtimeConfig).toMatchObject({
      transport: "unix-domain-socket",
      protocolVersion: 1,
    })
    expect(runtimeConfig.bootstrapPath).toMatch(
      /^\/tmp\/anybox-browser-[a-f0-9]{16}\/com\.anybox\.browser\.bootstrap\.json$/,
    )
    expect(runtimeConfig.runtimeEndpoint).toMatch(
      /^\/tmp\/anybox-browser-[a-f0-9]{16}\/runtime-v1-[a-f0-9]{16}\.sock$/,
    )
    expect(runtimeConfig.nativeHostEndpoint).toMatch(
      /^\/tmp\/anybox-browser-[a-f0-9]{16}\/native-host-v1-[a-f0-9]{16}\.sock$/,
    )
    expect(Buffer.byteLength(runtimeConfig.runtimeEndpoint)).toBeLessThanOrEqual(103)
    expect(Buffer.byteLength(runtimeConfig.nativeHostEndpoint)).toBeLessThanOrEqual(103)
    expect((await stat(first!.executablePath)).mode & 0o777).toBe(0o755)

    const [second] = await installPlatformArtifacts({
      ...installInput,
      existingReceipts: [first!],
    })
    expect(second!.ownershipID).toBe(first!.ownershipID)
    expect(second!.executablePath).toBe(first!.executablePath)
    expect((await stat(second!.executablePath)).mode & 0o777).toBe(0o755)

    await expect(removePlatformArtifacts({
      pluginID: "chrome",
      receipts: [second!],
      dataDir: input.dataDir,
    })).resolves.toEqual({
      removed: ["chrome-native-host"],
      skipped: [],
      pending: [],
    })
    await expect(access(second!.managedRoot)).rejects.toBeDefined()
    await expect(access(second!.manifestPaths[0]!)).rejects.toBeDefined()
    await expect(access(second!.runtimeConfigPath!)).rejects.toBeDefined()
  })

  test("leaves replaced resources untouched when the receipt no longer matches", async () => {
    const input = await fixture()
    const [receipt] = await installPlatformArtifacts({
      pluginID: "chrome",
      pluginVersion: "0.10.0",
      packageRoot: input.packageRoot,
      artifacts: [artifact()],
      platform: "linux",
      architecture: "x64",
      homeDir: input.homeDir,
      dataDir: input.dataDir,
      stateDir: input.stateDir,
      env: input.env,
    })
    const ownership = JSON.parse(await readFile(receipt!.ownershipPath, "utf8"))
    await writeFile(receipt!.ownershipPath, JSON.stringify({
      ...ownership,
      ownershipID: crypto.randomUUID(),
    }))

    const result = await removePlatformArtifacts({
      pluginID: "chrome",
      receipts: [receipt!],
      dataDir: input.dataDir,
    })
    expect(result.removed).toEqual([])
    expect(result.skipped).toEqual([{
      artifactID: "chrome-native-host",
      reason: "ownership receipt mismatch",
    }])
    expect(result.pending).toEqual([])
    await access(receipt!.managedRoot)
    await access(receipt!.manifestPaths[0]!)
  })

  test("defers a locked native-host binary and completes cleanup later", async () => {
    const input = await fixture()
    const [receipt] = await installPlatformArtifacts({
      pluginID: "chrome",
      pluginVersion: "0.10.0",
      packageRoot: input.packageRoot,
      artifacts: [artifact()],
      platform: "linux",
      architecture: "x64",
      homeDir: input.homeDir,
      dataDir: input.dataDir,
      stateDir: input.stateDir,
      env: input.env,
    })
    const lockedError = Object.assign(new Error("locked"), { code: "EBUSY" })

    const result = await removePlatformArtifacts({
      pluginID: "chrome",
      receipts: [receipt!],
      dataDir: input.dataDir,
      removeManagedRoot: async () => {
        throw lockedError
      },
    })

    expect(result).toMatchObject({
      removed: ["chrome-native-host"],
      skipped: [],
      pending: [{
        artifactID: "chrome-native-host",
        reason: "native host files are in use; cleanup was deferred",
      }],
    })
    await expect(access(receipt!.manifestPaths[0]!)).rejects.toBeDefined()
    await expect(access(receipt!.runtimeConfigPath!)).rejects.toBeDefined()

    await expect(retryPendingPlatformArtifactCleanup({
      dataDir: input.dataDir,
    })).resolves.toEqual({
      removed: ["chrome-native-host"],
      pending: [],
    })
    await expect(access(receipt!.managedRoot)).rejects.toBeDefined()
  })

  test("commits an upgrade while the replaced native host is still locked", async () => {
    const input = await fixture()
    const [first] = await installPlatformArtifacts({
      pluginID: "chrome",
      pluginVersion: "0.10.0",
      packageRoot: input.packageRoot,
      artifacts: [artifact()],
      platform: "linux",
      architecture: "x64",
      homeDir: input.homeDir,
      dataDir: input.dataDir,
      stateDir: input.stateDir,
      env: input.env,
    })
    await writeFile(input.executablePath, "native-host-v2")
    const lockedError = Object.assign(new Error("locked"), { code: "EBUSY" })

    const [second] = await installPlatformArtifacts({
      pluginID: "chrome",
      pluginVersion: "0.10.1",
      packageRoot: input.packageRoot,
      artifacts: [artifact()],
      existingReceipts: [first!],
      platform: "linux",
      architecture: "x64",
      homeDir: input.homeDir,
      dataDir: input.dataDir,
      stateDir: input.stateDir,
      env: input.env,
      removeReplacedCurrent: async () => {
        throw lockedError
      },
    })

    expect(second!.pluginVersion).toBe("0.10.1")
    expect(await readFile(second!.executablePath, "utf8")).toBe("native-host-v2")
    await expect(retryPendingPlatformArtifactCleanup({
      dataDir: input.dataDir,
    })).resolves.toEqual({
      removed: ["chrome-native-host"],
      pending: [],
    })
    expect(await readFile(second!.executablePath, "utf8")).toBe("native-host-v2")
  })

  test("moves Windows upgrades to a versioned path when legacy current is locked", async () => {
    const input = await fixture()
    const windowsArtifact = PluginPlatformArtifact.parse({
      ...artifact(),
      executables: [{
        platform: "win32",
        architecture: "x64",
        path: "bin/extension-host",
      }],
    })
    const run = async () => ({ stdout: "" })
    const installInput = {
      pluginID: "chrome",
      packageRoot: input.packageRoot,
      artifacts: [windowsArtifact],
      platform: "win32" as const,
      architecture: "x64" as const,
      homeDir: input.homeDir,
      dataDir: input.dataDir,
      stateDir: input.stateDir,
      env: {
        APPDATA: path.join(input.root, "app-data"),
      },
      run,
    }
    const [first] = await installPlatformArtifacts({
      ...installInput,
      pluginVersion: "0.10.0",
    })
    const legacyCurrent = path.join(first!.managedRoot, "current")
    await mkdir(legacyCurrent, { recursive: true })
    await writeFile(
      path.join(legacyCurrent, "extension-host.exe"),
      "legacy-native-host",
    )
    await writeFile(input.executablePath, "native-host-v2")
    const lockedError = Object.assign(new Error("locked"), { code: "EPERM" })

    const [second] = await installPlatformArtifacts({
      ...installInput,
      pluginVersion: "0.10.1",
      existingReceipts: [first!],
      removeReplacedCurrent: async () => {
        throw lockedError
      },
    })

    expect(second!.executablePath).toContain(
      `${path.sep}versions${path.sep}`,
    )
    expect(second!.executablePath).toContain(
      `${path.sep}win32-x64${path.sep}`,
    )
    expect(second!.executablePath).not.toContain(
      `${path.sep}current${path.sep}`,
    )
    expect(await readFile(second!.executablePath, "utf8")).toBe("native-host-v2")
    await expect(retryPendingPlatformArtifactCleanup({
      dataDir: input.dataDir,
    })).resolves.toEqual({
      removed: ["chrome-native-host"],
      pending: [],
    })
    await expect(access(legacyCurrent)).rejects.toBeDefined()
  })

  test("reuses an identical versioned Windows host during an in-use reinstall", async () => {
    const input = await fixture()
    const windowsArtifact = PluginPlatformArtifact.parse({
      ...artifact(),
      executables: [{
        platform: "win32",
        architecture: "x64",
        path: "bin/extension-host",
      }],
    })
    const installInput = {
      pluginID: "chrome",
      pluginVersion: "0.11.2",
      packageRoot: input.packageRoot,
      artifacts: [windowsArtifact],
      platform: "win32" as const,
      architecture: "x64" as const,
      homeDir: input.homeDir,
      dataDir: input.dataDir,
      stateDir: input.stateDir,
      env: {
        APPDATA: path.join(input.root, "app-data"),
      },
      run: async () => ({ stdout: "" }),
    }
    const [first] = await installPlatformArtifacts(installInput)
    let copyAttempted = false

    const [reinstalled] = await installPlatformArtifacts({
      ...installInput,
      copyVersionExecutable: async () => {
        copyAttempted = true
        throw Object.assign(new Error("active executable is locked"), {
          code: "EBUSY",
        })
      },
    })

    expect(copyAttempted).toBe(false)
    expect(reinstalled!.ownershipID).toBe(first!.ownershipID)
    expect(reinstalled!.executablePath).toBe(first!.executablePath)
    expect(await readFile(reinstalled!.executablePath, "utf8"))
      .toBe("native-host-v1")
  })

  test("rolls back an upgrade when platform registration fails", async () => {
    const input = await fixture()
    const windowsArtifact = PluginPlatformArtifact.parse({
      ...artifact(),
      executables: [{
        platform: "win32",
        architecture: "x64",
        path: "bin/extension-host",
      }],
    })
    let registryPath: string | undefined
    let failNextAdd = false
    const run = async (_file: string, args: string[]) => {
      if (args[0] === "query") {
        return {
          stdout: registryPath
            ? `    (Default)    REG_SZ    ${registryPath}\n`
            : "",
        }
      }
      if (args[0] === "add") {
        if (failNextAdd) {
          failNextAdd = false
          throw new Error("simulated registry failure")
        }
        registryPath = args[args.indexOf("/d") + 1]
        return {}
      }
      if (args[0] === "delete") {
        registryPath = undefined
        return {}
      }
      throw new Error(`Unexpected registry command: ${args.join(" ")}`)
    }
    const installInput = {
      pluginID: "chrome",
      packageRoot: input.packageRoot,
      artifacts: [windowsArtifact],
      platform: "win32" as const,
      architecture: "x64" as const,
      homeDir: input.homeDir,
      dataDir: input.dataDir,
      stateDir: input.stateDir,
      env: {
        APPDATA: path.join(input.root, "app-data"),
      },
      run,
    }
    const [first] = await installPlatformArtifacts({
      ...installInput,
      pluginVersion: "0.10.0",
    })
    const previousFiles = new Map(
      await Promise.all([
        first!.manifestPaths[0]!,
        first!.runtimeConfigPath!,
        first!.ownershipPath,
        first!.currentPointerPath,
      ].map(async (filePath) => [
        filePath,
        await readFile(filePath, "utf8"),
      ] as const)),
    )
    const previousRegistryPath = registryPath

    await writeFile(input.executablePath, "native-host-v2")
    failNextAdd = true
    await expect(installPlatformArtifacts({
      ...installInput,
      pluginVersion: "0.10.1",
      existingReceipts: [first!],
    })).rejects.toMatchObject({
      code: "PLATFORM_ARTIFACT_INSTALL_FAILED",
    })

    expect(await readFile(first!.executablePath, "utf8")).toBe("native-host-v1")
    for (const [filePath, contents] of previousFiles) {
      expect(await readFile(filePath, "utf8")).toBe(contents)
    }
    expect(registryPath).toBe(previousRegistryPath)
  })
})
