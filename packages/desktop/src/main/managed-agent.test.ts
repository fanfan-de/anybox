import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const electronAppMock = vi.hoisted(() => ({
  name: "Anybox",
  isPackaged: false,
  appPath: "",
  paths: {
    home: "",
    userData: "",
  } as Record<string, string>,
}))

const electronSessionMock = vi.hoisted(() => ({
  resolveProxy: vi.fn(),
}))

vi.mock("electron", () => ({
  app: {
    get isPackaged() {
      return electronAppMock.isPackaged
    },
    getName: vi.fn(() => electronAppMock.name),
    getAppPath: vi.fn(() => electronAppMock.appPath),
    getPath: vi.fn((name: string) => electronAppMock.paths[name] ?? ""),
  },
  session: {
    defaultSession: {
      resolveProxy: electronSessionMock.resolveProxy,
    },
  },
}))

import { managedAgentInternals } from "./managed-agent"

const tempDirectories: string[] = []

async function createTempDirectory(prefix: string) {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix))
  tempDirectories.push(directory)
  return directory
}

async function withProcessEnv<T>(
  overrides: Record<string, string | undefined>,
  fn: () => T | Promise<T>,
): Promise<T> {
  const backup = new Map<string, string | undefined>()

  for (const [key, value] of Object.entries(overrides)) {
    backup.set(key, process.env[key])
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }

  try {
    return await fn()
  } finally {
    for (const [key, value] of backup.entries()) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
}

beforeEach(() => {
  electronAppMock.name = "Anybox"
  electronAppMock.isPackaged = false
  electronAppMock.appPath = ""
  electronAppMock.paths = {
    home: "",
    userData: "",
  }
  electronSessionMock.resolveProxy.mockReset()
})

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })))
})

describe("managed agent unexpected-exit restart", () => {
  it("restarts once after the delay when enabled", async () => {
    vi.useFakeTimers()
    const restart = vi.fn().mockResolvedValue(undefined)
    const controller = managedAgentInternals.createManagedAgentRestartController({
      delayMs: 250,
      restart,
    })

    controller.enable()
    controller.schedule("exit 1")
    controller.schedule("duplicate exit")

    await vi.advanceTimersByTimeAsync(249)
    expect(restart).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(restart).toHaveBeenCalledTimes(1)
  })

  it("cancels a scheduled restart when shutdown disables the controller", async () => {
    vi.useFakeTimers()
    const restart = vi.fn().mockResolvedValue(undefined)
    const controller = managedAgentInternals.createManagedAgentRestartController({
      delayMs: 250,
      restart,
    })

    controller.enable()
    controller.schedule("exit 1")
    controller.disable()
    await vi.advanceTimersByTimeAsync(250)

    expect(restart).not.toHaveBeenCalled()
  })
})

describe("managed agent workspace dependencies", () => {
  it("adds bundled workspace dependency paths and versions to launch env", async () => {
    const runtimeDir = await createTempDirectory("anybox-managed-agent-runtime-")
    const dependenciesDir = path.join(runtimeDir, "dependencies")
    const connectorBuildConfigPath = path.join(runtimeDir, "config", "connectors.json")

    await mkdir(dependenciesDir, { recursive: true })
    await mkdir(path.dirname(connectorBuildConfigPath), { recursive: true })
    await writeFile(path.join(runtimeDir, process.platform === "win32" ? "bun.exe" : "bun"), "")
    await writeFile(path.join(runtimeDir, "agent-server.js"), "")
    await writeFile(connectorBuildConfigPath, JSON.stringify({ schemaVersion: 1, gmailOAuthClientID: "client.test" }))
    await writeFile(
      path.join(dependenciesDir, "manifest.json"),
      JSON.stringify({
        kind: "anybox-workspace-dependencies",
        version: 1,
        bundleVersion: "bundle-test-version",
      }),
    )

    await withProcessEnv(
      {
        ANYBOX_AGENT_RUNTIME_DIR: runtimeDir,
      },
      () => {
        const specs = managedAgentInternals.resolveBundledAgentLaunchSpecs()
        const spec = specs.find((item) => item.args[0] === path.join(runtimeDir, "agent-server.js"))
        expect(spec).toMatchObject({
          dependenciesDir,
          sourceRuntime: false,
        })

        const agentDataDir = path.join(runtimeDir, "agent-data")
        const env = managedAgentInternals.buildManagedAgentStartEnv(spec!, 4567, agentDataDir)
        expect(env[managedAgentInternals.env.workspaceDependenciesDir]).toBe(dependenciesDir)
        expect(env[managedAgentInternals.env.workspaceDependenciesVersion]).toBe("bundle-test-version")
        expect(env[managedAgentInternals.env.agentDataDir]).toBe(agentDataDir)
        expect(env[managedAgentInternals.env.desktopProcessID]).toBe(String(process.pid))
        expect(String(env[managedAgentInternals.env.protectedProcessNames])).toContain("anybox.exe")
        expect(env.ANYBOX_CONNECTOR_BUILD_CONFIG).toBe(connectorBuildConfigPath)
        expect(env.ANYBOX_SERVER_PORT).toBe("4567")
      },
    )
  })

  it("points source runtimes at the build dependency directory without requiring it to exist", async () => {
    const repoRoot = await createTempDirectory("anybox-managed-agent-source-")
    const desktopAppPath = path.join(repoRoot, "packages", "desktop")
    const agentEntrypoint = path.join(repoRoot, "packages", "anyboxagent", "src", "server", "start.ts")
    const bunBinary = path.join(repoRoot, process.platform === "win32" ? "bun.exe" : "bun")
    const dependenciesDir = path.join(desktopAppPath, "build", "agent-runtime", "dependencies")

    await mkdir(path.dirname(agentEntrypoint), { recursive: true })
    await mkdir(desktopAppPath, { recursive: true })
    await writeFile(agentEntrypoint, "export {}\n")
    await writeFile(bunBinary, "")
    electronAppMock.appPath = desktopAppPath

    await withProcessEnv(
      {
        ANYBOX_BUN_BINARY: bunBinary,
      },
      () => {
        const spec = managedAgentInternals.resolveSourceAgentLaunchSpec()
        expect(spec).toMatchObject({
          command: bunBinary,
          dependenciesDir,
          sourceRuntime: true,
        })

        const env = managedAgentInternals.buildManagedAgentStartEnv(spec!, 4096)
        expect(env[managedAgentInternals.env.workspaceDependenciesDir]).toBe(dependenciesDir)
        expect(env[managedAgentInternals.env.workspaceDependenciesVersion]).toBeUndefined()
      },
    )
  })

  it("passes verified bundled media tools to the managed agent without overriding explicit paths", async () => {
    const runtimeDir = await createTempDirectory("anybox-managed-agent-media-")
    const mediaToolsDir = path.join(runtimeDir, "media-tools")
    const ffmpeg = path.join(mediaToolsDir, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg")
    const ffprobe = path.join(mediaToolsDir, process.platform === "win32" ? "ffprobe.exe" : "ffprobe")
    await mkdir(mediaToolsDir, { recursive: true })
    await writeFile(ffmpeg, "")
    await writeFile(ffprobe, "")

    const spec = {
      label: "media runtime",
      command: "bun",
      args: ["agent-server.js"],
      runtimeDir,
      sourceRuntime: false,
    }
    const bundledEnv = managedAgentInternals.buildManagedAgentStartEnv(spec, 4096)
    expect(bundledEnv[managedAgentInternals.env.ffmpegBinary]).toBe(ffmpeg)
    expect(bundledEnv[managedAgentInternals.env.ffprobeBinary]).toBe(ffprobe)

    await withProcessEnv({
      ANYBOX_FFMPEG_BINARY: "C:/custom/ffmpeg.exe",
      ANYBOX_FFPROBE_BINARY: "C:/custom/ffprobe.exe",
    }, () => {
      const explicitEnv = managedAgentInternals.buildManagedAgentStartEnv(spec, 4096)
      expect(explicitEnv[managedAgentInternals.env.ffmpegBinary]).toBe("C:/custom/ffmpeg.exe")
      expect(explicitEnv[managedAgentInternals.env.ffprobeBinary]).toBe("C:/custom/ffprobe.exe")
    })
  })

  it("forces the bundled media pair and only enables Deliver for an approved packaged release target", async () => {
    const isReleaseTarget = (process.platform === "win32" && process.arch === "x64")
      || (process.platform === "darwin" && process.arch === "arm64")
      || (process.platform === "linux" && process.arch === "x64")
    if (!isReleaseTarget) return
    const runtimeDir = await createTempDirectory("anybox-managed-agent-packaged-media-")
    const mediaToolsDir = path.join(runtimeDir, "media-tools")
    const ffmpeg = path.join(mediaToolsDir, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg")
    const ffprobe = path.join(mediaToolsDir, process.platform === "win32" ? "ffprobe.exe" : "ffprobe")
    await mkdir(mediaToolsDir, { recursive: true })
    await writeFile(ffmpeg, "")
    await writeFile(ffprobe, "")
    await writeFile(path.join(mediaToolsDir, "manifest.json"), JSON.stringify({
      runtimeID: "ffmpeg-anybox-approved-test",
      platform: process.platform,
      arch: process.arch,
      releaseReadiness: { status: "approved" },
      licensePolicy: { reviewStatus: "approved" },
      executables: {
        ffmpeg: path.basename(ffmpeg),
        ffprobe: path.basename(ffprobe),
      },
    }))
    electronAppMock.isPackaged = true

    await withProcessEnv({
      ANYBOX_FFMPEG_BINARY: "C:/unverified/ffmpeg.exe",
      ANYBOX_FFPROBE_BINARY: "C:/unverified/ffprobe.exe",
      ANYBOX_COMPUTER_USE_REQUIRE_SIGNATURE: "0",
    }, () => {
      const env = managedAgentInternals.buildManagedAgentStartEnv({
        label: "packaged media runtime",
        command: "bun",
        args: ["agent-server.js"],
        runtimeDir,
        sourceRuntime: false,
      }, 4096)
      expect(env[managedAgentInternals.env.ffmpegBinary]).toBe(ffmpeg)
      expect(env[managedAgentInternals.env.ffprobeBinary]).toBe(ffprobe)
      expect(env[managedAgentInternals.env.mediaRuntimeStrict]).toBe("1")
      expect(env[managedAgentInternals.env.timelineDelivery]).toBe("1")
      expect(env[managedAgentInternals.env.computerUseRequireSignature]).toBe("1")
    })

    await writeFile(path.join(mediaToolsDir, "manifest.json"), JSON.stringify({
      runtimeID: "ffmpeg-anybox-blocked-test",
      platform: process.platform,
      arch: process.arch,
      releaseReadiness: { status: "blocked" },
      licensePolicy: { reviewStatus: "pending" },
      executables: {
        ffmpeg: path.basename(ffmpeg),
        ffprobe: path.basename(ffprobe),
      },
    }))
    const blockedEnv = managedAgentInternals.buildManagedAgentStartEnv({
      label: "blocked packaged media runtime",
      command: "bun",
      args: ["agent-server.js"],
      runtimeDir,
      sourceRuntime: false,
    }, 4096)
    expect(blockedEnv[managedAgentInternals.env.timelineDelivery]).toBeUndefined()
  })

  it("does not pass plugin install directory overrides to the managed agent", async () => {
    const runtimeDir = await createTempDirectory("anybox-managed-agent-runtime-")
    const agentDataDir = path.join(runtimeDir, "agent-data")

    await withProcessEnv(
      {
        ANYBOX_PLUGIN_INSTALL_DIR: String.raw`C:\wrong-plugin-root`,
      },
      () => {
        const env = managedAgentInternals.buildManagedAgentStartEnv(
          {
            label: "test runtime",
            command: "bun",
            args: ["agent-server.js"],
            sourceRuntime: false,
          },
          4096,
          agentDataDir,
        )

        expect(env.ANYBOX_PLUGIN_INSTALL_DIR).toBeUndefined()
        expect(env[managedAgentInternals.env.agentDataDir]).toBe(agentDataDir)
      },
    )
  })
})

describe("managed agent proxy environment", () => {
  it("converts Electron system proxy rules into launch env", async () => {
    electronSessionMock.resolveProxy.mockResolvedValue("PROXY 127.0.0.1:7890; DIRECT")

    await withProcessEnv(
      {
        HTTPS_PROXY: undefined,
        HTTP_PROXY: undefined,
        ALL_PROXY: undefined,
        https_proxy: undefined,
        http_proxy: undefined,
        all_proxy: undefined,
      },
      async () => {
        const proxyEnv = await managedAgentInternals.resolveManagedAgentProxyEnv()
        expect(proxyEnv).toEqual({
          HTTP_PROXY: "http://127.0.0.1:7890",
          HTTPS_PROXY: "http://127.0.0.1:7890",
        })
        expect(electronSessionMock.resolveProxy).toHaveBeenCalledWith("https://anybox.com.cn")
      },
    )
  })

  it("does not override explicitly configured proxy env", async () => {
    electronSessionMock.resolveProxy.mockResolvedValue("PROXY 127.0.0.1:7890")

    await withProcessEnv(
      {
        HTTPS_PROXY: "http://manual-proxy.test:8080",
        HTTP_PROXY: undefined,
        ALL_PROXY: undefined,
      },
      async () => {
        await expect(managedAgentInternals.resolveManagedAgentProxyEnv()).resolves.toEqual({})
        expect(electronSessionMock.resolveProxy).not.toHaveBeenCalled()
      },
    )
  })

  it("ignores direct and unsupported proxy rules", () => {
    expect(managedAgentInternals.proxyURLFromElectronProxyRule("DIRECT")).toBeUndefined()
    expect(managedAgentInternals.proxyURLFromElectronProxyRule("SOCKS5 127.0.0.1:7891")).toBeUndefined()
    expect(managedAgentInternals.proxyURLFromElectronProxyRule("HTTPS proxy.test:8443")).toBe("http://proxy.test:8443")
  })
})
