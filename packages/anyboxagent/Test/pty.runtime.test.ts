import { afterEach, describe, expect, test } from "bun:test"
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  POWERSHELL_7_INSTALL_MESSAGE,
  type PowerShell7Detector,
} from "@anybox/platform"
import {
  ensureMacOSNodePtySpawnHelperExecutable,
  buildPtyShellArgs,
  createNodePtyRuntimeAdapter,
  isPtyRuntimeError,
  resolveDefaultPtyShell,
  shouldUseNodePtySidecar,
  toPtyCreateError,
} from "#pty/runtime.ts"

const tempRoots: string[] = []

function unavailablePowerShellDetector(): PowerShell7Detector {
  return {
    async detect() {
      return {
        available: false,
        message: POWERSHELL_7_INSTALL_MESSAGE,
        detail: "missing",
      }
    },
    async validate() {
      return {
        available: false,
        message: POWERSHELL_7_INSTALL_MESSAGE,
        detail: "missing",
      }
    },
  }
}

async function makeTempRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "anybox-pty-runtime-"))
  tempRoots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("pty runtime", () => {
  test.skipIf(process.platform === "win32")("makes the macOS node-pty spawn helper executable", async () => {
    const packageRoot = await makeTempRoot()
    const helperPath = path.join(packageRoot, "prebuilds", "darwin-arm64", "spawn-helper")
    await mkdir(path.dirname(helperPath), { recursive: true })
    await writeFile(helperPath, "")
    await chmod(helperPath, 0o644)

    await expect(
      ensureMacOSNodePtySpawnHelperExecutable({
        arch: "arm64",
        packageRoot,
        platform: "darwin",
      }),
    ).resolves.toBe(helperPath)

    const helperStat = await stat(helperPath)
    expect(helperStat.mode & 0o111).not.toBe(0)
  })

  test("rejects an explicit terminal shell that does not exist", async () => {
    const packageRoot = await makeTempRoot()
    const missingShell = path.join(packageRoot, "missing-shell")

    try {
      await resolveDefaultPtyShell(missingShell)
      throw new Error("resolveDefaultPtyShell unexpectedly succeeded")
    } catch (error) {
      expect(isPtyRuntimeError(error)).toBe(true)
      if (isPtyRuntimeError(error)) {
        expect(error.code).toBe("PTY_CREATE_FAILED")
        expect(error.message).toContain(missingShell)
      }
    }
  })

  test.each([
    "powershell",
    "powershell.exe",
    "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
  ])("rejects Windows PowerShell 5.1 passed by name or absolute path: %s", async (shell) => {
    await expect(resolveDefaultPtyShell(shell)).rejects.toThrow(
      "Windows PowerShell 5.1 (powershell.exe) is not supported",
    )
  })

  test("rejects Windows PowerShell 5.1 passed through the terminal environment", async () => {
    await expect(resolveDefaultPtyShell(undefined, {
      platform: "win32",
      env: {
        ANYBOX_PTY_SHELL: "powershell.exe",
        PATH: "",
      },
      configuredGitBashPath: null,
      powerShellDetector: unavailablePowerShellDetector(),
    })).rejects.toThrow("Windows PowerShell 5.1 (powershell.exe) is not supported")
  })

  test("validates an explicitly selected pwsh.exe before starting it", async () => {
    const root = await makeTempRoot()
    const executable = path.join(root, "pwsh.exe")
    await writeFile(executable, "")
    const validated: string[] = []
    const detector: PowerShell7Detector = {
      async detect() {
        throw new Error("detect should not be called for an absolute pwsh path")
      },
      async validate(candidate) {
        validated.push(candidate)
        return {
          available: true,
          executable: candidate,
          version: "7.6.4",
          edition: "Core",
          major: 7,
        }
      },
    }

    await expect(resolveDefaultPtyShell(executable, {
      platform: "win32",
      env: { PATH: "" },
      configuredGitBashPath: null,
      powerShellDetector: detector,
    })).resolves.toBe(executable)
    expect(validated).toEqual([executable])
  })

  test("uses the shared detected PowerShell 7 path for the pwsh profile", async () => {
    let detects = 0
    const detector: PowerShell7Detector = {
      async detect() {
        detects += 1
        return {
          available: true,
          executable: "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
          version: "7.6.4",
          edition: "Core",
          major: 7,
        }
      },
      async validate() {
        throw new Error("validate should not be called for the pwsh profile name")
      },
    }

    await expect(resolveDefaultPtyShell("pwsh.exe", {
      platform: "win32",
      env: { PATH: "" },
      configuredGitBashPath: null,
      powerShellDetector: detector,
    })).resolves.toBe("C:\\Program Files\\PowerShell\\7\\pwsh.exe")
    expect(detects).toBe(1)
  })

  test("falls back to Command Prompt when PowerShell 7 is unavailable", async () => {
    await expect(resolveDefaultPtyShell(undefined, {
      platform: "win32",
      env: { PATH: "", ComSpec: "" },
      configuredGitBashPath: null,
      powerShellDetector: unavailablePowerShellDetector(),
    })).resolves.toBe("cmd.exe")
  })

  test("maps spawn failures to PTY_CREATE_FAILED", () => {
    const error = toPtyCreateError(new Error("posix_spawnp failed"), "/bin/zsh")

    expect(error.code).toBe("PTY_CREATE_FAILED")
    expect(error.message).toContain("/bin/zsh")
    expect(error.message).toContain("posix_spawnp failed")
  })

  test("starts PowerShell 7 PTYs with UTF-8 configured and leaves other shells unchanged", () => {
    expect(buildPtyShellArgs("C:\\Program Files\\PowerShell\\7\\pwsh.exe")).toEqual([
      "-NoExit",
      "-Command",
      expect.stringContaining("[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)"),
    ])
    expect(buildPtyShellArgs("cmd.exe")).toEqual([])
    expect(buildPtyShellArgs("bash.exe")).toEqual([])
  })

  test("uses the Node PTY sidecar whenever the server runs on Bun", () => {
    expect(shouldUseNodePtySidecar({ isBun: true })).toBe(true)
    expect(shouldUseNodePtySidecar({ isBun: false })).toBe(false)
  })

  test("sidecar preserves quick output, argv, and the real non-zero PTY exit code", async () => {
    const runtime = createNodePtyRuntimeAdapter()
    const script = [
      "const ok = process.argv.includes('anybox-pty-argv')",
      "process.stdout.write(ok ? 'argv-ok' : 'argv-missing')",
      "process.exit(7)",
    ].join(";")
    const handle = await runtime.spawn({
      executable: process.execPath,
      args: ["-e", script, "anybox-pty-argv"],
      cwd: process.cwd(),
      env: process.env,
    })

    await Bun.sleep(100)
    let output = ""
    handle.onData((data) => {
      output += data
    })
    const exit = await new Promise<{ exitCode: number | null; signal?: number }>((resolve) => {
      handle.onExit(resolve)
    })

    expect(output).toContain("argv-ok")
    expect(exit.exitCode).toBe(7)
  }, 30_000)
})
