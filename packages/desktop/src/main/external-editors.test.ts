import type fs from "node:fs"
import { describe, expect, it, vi } from "vitest"
import {
  buildExternalEditorLaunchSpec,
  listAvailableExternalEditors,
  listAvailableExternalEditorsForTarget,
  openInExternalEditor,
  type ExternalEditorSummary,
} from "./external-editors"

function createDirent(name: string, type: "file" | "directory") {
  return {
    name,
    isDirectory: () => type === "directory",
    isFile: () => type === "file",
  } as unknown as fs.Dirent
}

describe("external editor helpers", () => {
  it("prefers command resolution before scanning common install paths and preserves icon paths for wrapped launchers", () => {
    const result = listAvailableExternalEditors({
      platform: "win32",
      env: {
        LOCALAPPDATA: "C:\\Users\\demo\\AppData\\Local",
        ProgramFiles: "C:\\Program Files",
        "ProgramFiles(x86)": "C:\\Program Files (x86)",
        SystemRoot: "C:\\Windows",
      },
      existsSync: (targetPath) =>
        [
          "C:\\Users\\demo\\AppData\\Local\\Programs\\Microsoft VS Code\\bin\\code.cmd",
          "C:\\Users\\demo\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe",
          "C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\Common7\\IDE\\devenv.exe",
          "C:\\Users\\demo\\AppData\\Local\\Programs\\Cursor\\Cursor.exe",
          "C:\\Users\\demo\\AppData\\Local\\GitHubDesktop\\bin\\github.bat",
          "C:\\Users\\demo\\AppData\\Local\\GitHubDesktop\\GitHubDesktop.exe",
          "C:\\Windows\\explorer.exe",
          "C:\\Windows\\System32\\wsl.exe",
        ].includes(targetPath),
      resolveCommand: (commandName) =>
        ({
          code: "C:\\Users\\demo\\AppData\\Local\\Programs\\Microsoft VS Code\\bin\\code",
          github: "C:\\Users\\demo\\AppData\\Local\\GitHubDesktop\\bin\\github",
          wt: "C:\\Users\\demo\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe",
        })[commandName],
    })

    expect(result).toEqual([
      {
        id: "vscode",
        label: "VS Code",
        executablePath: "C:\\Users\\demo\\AppData\\Local\\Programs\\Microsoft VS Code\\bin\\code.cmd",
        iconPath: "C:\\Users\\demo\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe",
      },
      {
        id: "visualstudio",
        label: "Visual Studio",
        executablePath: "C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\Common7\\IDE\\devenv.exe",
      },
      {
        id: "cursor",
        label: "Cursor",
        executablePath: "C:\\Users\\demo\\AppData\\Local\\Programs\\Cursor\\Cursor.exe",
      },
      {
        id: "githubDesktop",
        label: "GitHub Desktop",
        executablePath: "C:\\Users\\demo\\AppData\\Local\\GitHubDesktop\\bin\\github.bat",
        iconPath: "C:\\Users\\demo\\AppData\\Local\\GitHubDesktop\\GitHubDesktop.exe",
      },
      {
        id: "explorer",
        label: "File Explorer",
        executablePath: "C:\\Windows\\explorer.exe",
      },
      {
        id: "terminal",
        label: "Terminal",
        executablePath: "C:\\Users\\demo\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe",
      },
      {
        id: "wsl",
        label: "WSL",
        executablePath: "C:\\Windows\\System32\\wsl.exe",
      },
    ])
  })

  it("filters target-specific launchers to supported repositories and project layouts", () => {
    const targetPath = "C:\\Projects\\Atlas"

    expect(
      listAvailableExternalEditorsForTarget(targetPath, {
        platform: "win32",
        env: {
          LOCALAPPDATA: "C:\\Users\\demo\\AppData\\Local",
          ProgramFiles: "C:\\Program Files",
          "ProgramFiles(x86)": "C:\\Program Files (x86)",
          SystemRoot: "C:\\Windows",
        },
        existsSync: (candidatePath) =>
          [
            "C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\Common7\\IDE\\devenv.exe",
            "C:\\Users\\demo\\AppData\\Local\\GitHubDesktop\\bin\\github.bat",
            "C:\\Users\\demo\\AppData\\Local\\GitHubDesktop\\GitHubDesktop.exe",
            "C:\\Users\\demo\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe",
            "C:\\Windows\\explorer.exe",
            "C:\\Windows\\System32\\wsl.exe",
            "C:\\Projects\\Atlas\\.git",
          ].includes(candidatePath),
        resolveCommand: (commandName) =>
          ({
            github: "C:\\Users\\demo\\AppData\\Local\\GitHubDesktop\\bin\\github",
            wt: "C:\\Users\\demo\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe",
          })[commandName],
        readdirSync: ((directoryPath: string) => {
          if (directoryPath === targetPath) {
            return [createDirent("src", "directory")]
          }
          if (directoryPath === "C:\\Projects\\Atlas\\src") {
            return [createDirent("Atlas.sln", "file")]
          }
          return []
        }) as unknown as typeof import("node:fs").readdirSync,
      }).map((editor) => editor.id),
    ).toEqual(["visualstudio", "githubDesktop", "explorer", "terminal", "wsl"])

    expect(
      listAvailableExternalEditorsForTarget(targetPath, {
        platform: "win32",
        env: {
          LOCALAPPDATA: "C:\\Users\\demo\\AppData\\Local",
          ProgramFiles: "C:\\Program Files",
          "ProgramFiles(x86)": "C:\\Program Files (x86)",
          SystemRoot: "C:\\Windows",
        },
        existsSync: (candidatePath) =>
          [
            "C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\Common7\\IDE\\devenv.exe",
            "C:\\Users\\demo\\AppData\\Local\\GitHubDesktop\\bin\\github.bat",
            "C:\\Users\\demo\\AppData\\Local\\GitHubDesktop\\GitHubDesktop.exe",
            "C:\\Users\\demo\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe",
            "C:\\Windows\\explorer.exe",
            "C:\\Windows\\System32\\wsl.exe",
          ].includes(candidatePath),
        resolveCommand: (commandName) =>
          ({
            github: "C:\\Users\\demo\\AppData\\Local\\GitHubDesktop\\bin\\github",
            wt: "C:\\Users\\demo\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe",
          })[commandName],
        readdirSync: (() => []) as unknown as typeof import("node:fs").readdirSync,
      }).map((editor) => editor.id),
    ).toEqual(["explorer", "terminal", "wsl"])
  })

  it("discovers macOS app bundles and uses platform-specific labels", () => {
    const result = listAvailableExternalEditors({
      platform: "darwin",
      env: {
        HOME: "/Users/demo",
      },
      existsSync: (targetPath) =>
        [
          "/Applications/Visual Studio Code.app",
          "/Applications/Cursor.app",
          "/Users/demo/Applications/Windsurf.app",
          "/Applications/GitHub Desktop.app",
          "/System/Library/CoreServices/Finder.app",
          "/System/Applications/Utilities/Terminal.app",
        ].includes(targetPath),
      resolveCommand: () => undefined,
    })

    expect(result).toEqual([
      {
        id: "vscode",
        label: "VS Code",
        executablePath: "/Applications/Visual Studio Code.app",
      },
      {
        id: "cursor",
        label: "Cursor",
        executablePath: "/Applications/Cursor.app",
      },
      {
        id: "windsurf",
        label: "Windsurf",
        executablePath: "/Users/demo/Applications/Windsurf.app",
      },
      {
        id: "githubDesktop",
        label: "GitHub Desktop",
        executablePath: "/Applications/GitHub Desktop.app",
      },
      {
        id: "explorer",
        label: "Finder",
        executablePath: "/System/Library/CoreServices/Finder.app",
      },
      {
        id: "terminal",
        label: "Terminal",
        executablePath: "/System/Applications/Utilities/Terminal.app",
      },
    ])
  })

  it("filters GitHub Desktop on macOS using the POSIX git directory path", () => {
    const targetPath = "/Users/demo/Atlas"

    expect(
      listAvailableExternalEditorsForTarget(targetPath, {
        platform: "darwin",
        existsSync: (candidatePath) =>
          [
            "/Applications/GitHub Desktop.app",
            "/System/Library/CoreServices/Finder.app",
            "/System/Applications/Utilities/Terminal.app",
            "/Users/demo/Atlas/.git",
          ].includes(candidatePath),
        resolveCommand: () => undefined,
      }).map((editor) => editor.id),
    ).toEqual(["githubDesktop", "explorer", "terminal"])

    expect(
      listAvailableExternalEditorsForTarget(targetPath, {
        platform: "darwin",
        existsSync: (candidatePath) =>
          [
            "/Applications/GitHub Desktop.app",
            "/System/Library/CoreServices/Finder.app",
            "/System/Applications/Utilities/Terminal.app",
          ].includes(candidatePath),
        resolveCommand: () => undefined,
      }).map((editor) => editor.id),
    ).toEqual(["explorer", "terminal"])
  })

  it("wraps cmd launchers in a shell while leaving executables direct", () => {
    const commandLineEditor = {
      id: "vscode",
      label: "VS Code",
      executablePath: "C:\\Users\\demo\\AppData\\Local\\Programs\\Microsoft VS Code\\bin\\code.cmd",
      iconPath: "C:\\Users\\demo\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe",
    } satisfies ExternalEditorSummary

    const guiEditor = {
      id: "cursor",
      label: "Cursor",
      executablePath: "C:\\Users\\demo\\AppData\\Local\\Programs\\Cursor\\Cursor.exe",
    } satisfies ExternalEditorSummary

    expect(buildExternalEditorLaunchSpec(commandLineEditor, "C:\\Projects\\Atlas", { env: { SystemRoot: "C:\\Windows" }, platform: "win32" })).toEqual({
      command: "C:\\Windows\\System32\\cmd.exe",
      args: ["/d", "/s", "/c", "\"\"C:\\Users\\demo\\AppData\\Local\\Programs\\Microsoft VS Code\\bin\\code.cmd\" \"C:\\Projects\\Atlas\""],
      shell: false,
      waitForExit: true,
      windowsHide: true,
      windowsVerbatimArguments: true,
    })
    expect(buildExternalEditorLaunchSpec(guiEditor, "C:\\Projects\\Atlas", { env: { SystemRoot: "C:\\Windows" }, platform: "win32" })).toEqual({
      command: guiEditor.executablePath,
      args: ["C:\\Projects\\Atlas"],
      shell: false,
      waitForExit: false,
      windowsHide: true,
      windowsVerbatimArguments: false,
    })
  })

  it("uses target-aware launch arguments for Visual Studio, Terminal, and WSL", () => {
    const visualStudioEditor = {
      id: "visualstudio",
      label: "Visual Studio",
      executablePath: "C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\Common7\\IDE\\devenv.exe",
    } satisfies ExternalEditorSummary
    const terminalEditor = {
      id: "terminal",
      label: "Terminal",
      executablePath: "C:\\Users\\demo\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe",
    } satisfies ExternalEditorSummary
    const wslEditor = {
      id: "wsl",
      label: "WSL",
      executablePath: "C:\\Windows\\System32\\wsl.exe",
    } satisfies ExternalEditorSummary

    expect(
      buildExternalEditorLaunchSpec(visualStudioEditor, "C:\\Projects\\Atlas", {
        platform: "win32",
        readdirSync: ((directoryPath: string) => {
          if (directoryPath === "C:\\Projects\\Atlas") {
            return [createDirent("src", "directory")]
          }
          if (directoryPath === "C:\\Projects\\Atlas\\src") {
            return [createDirent("Atlas.sln", "file")]
          }
          return []
        }) as unknown as typeof import("node:fs").readdirSync,
      }),
    ).toEqual({
      command: visualStudioEditor.executablePath,
      args: ["C:\\Projects\\Atlas\\src\\Atlas.sln"],
      shell: false,
      waitForExit: false,
      windowsHide: true,
      windowsVerbatimArguments: false,
    })
    expect(buildExternalEditorLaunchSpec(terminalEditor, "C:\\Projects\\Atlas", { env: { SystemRoot: "C:\\Windows" }, platform: "win32" })).toEqual({
      command: "C:\\Windows\\System32\\cmd.exe",
      args: ["/d", "/s", "/c", "\"start \"\" \"C:\\Users\\demo\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe\" \"-d\" \"C:\\Projects\\Atlas\"\""],
      shell: false,
      waitForExit: true,
      windowsHide: true,
      windowsVerbatimArguments: true,
    })
    expect(buildExternalEditorLaunchSpec(wslEditor, "C:\\Projects\\Atlas", { platform: "win32" })).toEqual({
      command: wslEditor.executablePath,
      args: ["--cd", "C:\\Projects\\Atlas"],
      shell: false,
      waitForExit: false,
      windowsHide: false,
      windowsVerbatimArguments: false,
    })
  })

  it("uses macOS open commands for app bundles, Finder, and Terminal", () => {
    const cursorEditor = {
      id: "cursor",
      label: "Cursor",
      executablePath: "/Applications/Cursor.app",
    } satisfies ExternalEditorSummary
    const finderEditor = {
      id: "explorer",
      label: "Finder",
      executablePath: "/System/Library/CoreServices/Finder.app",
    } satisfies ExternalEditorSummary
    const terminalEditor = {
      id: "terminal",
      label: "Terminal",
      executablePath: "/System/Applications/Utilities/Terminal.app",
    } satisfies ExternalEditorSummary

    expect(buildExternalEditorLaunchSpec(cursorEditor, "/Users/demo/Atlas", { platform: "darwin" })).toEqual({
      command: "/usr/bin/open",
      args: ["-a", "Cursor", "/Users/demo/Atlas"],
      shell: false,
      waitForExit: true,
      windowsHide: true,
      windowsVerbatimArguments: false,
    })
    expect(buildExternalEditorLaunchSpec(finderEditor, "/Users/demo/Atlas", { platform: "darwin" })).toEqual({
      command: "/usr/bin/open",
      args: ["/Users/demo/Atlas"],
      shell: false,
      waitForExit: true,
      windowsHide: true,
      windowsVerbatimArguments: false,
    })
    expect(buildExternalEditorLaunchSpec(terminalEditor, "/Users/demo/Atlas", { platform: "darwin" })).toEqual({
      command: "/usr/bin/open",
      args: ["-a", "Terminal", "/Users/demo/Atlas"],
      shell: false,
      waitForExit: true,
      windowsHide: true,
      windowsVerbatimArguments: false,
    })
  })

  it("launches the selected editor for an existing workspace directory", async () => {
    const unref = vi.fn()
    const spawnProcess = vi.fn(() => ({
      once: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
        if (event === "spawn") {
          listener()
        }
      }),
      removeListener: vi.fn(),
      unref,
    }))

    const result = await openInExternalEditor(
      {
        editorID: "cursor",
        targetPath: "C:\\Projects\\Atlas",
      },
      {
        platform: "win32",
        resolveCommand: (commandName) => (commandName === "cursor" ? "C:\\Users\\demo\\AppData\\Local\\Programs\\Cursor\\Cursor.exe" : undefined),
        spawnProcess: spawnProcess as unknown as typeof import("node:child_process").spawn,
        statSync: ((_targetPath: string) =>
          ({
            isDirectory: () => true,
          }) as import("node:fs").Stats) as typeof import("node:fs").statSync,
      },
    )

    expect(result).toEqual({
      ok: true,
      editor: {
        id: "cursor",
        label: "Cursor",
        executablePath: "C:\\Users\\demo\\AppData\\Local\\Programs\\Cursor\\Cursor.exe",
      },
      targetPath: "C:\\Projects\\Atlas",
    })
    expect(spawnProcess).toHaveBeenCalledWith(
      "C:\\Users\\demo\\AppData\\Local\\Programs\\Cursor\\Cursor.exe",
      ["C:\\Projects\\Atlas"],
      expect.objectContaining({
        detached: true,
        shell: false,
        stdio: "ignore",
        windowsHide: true,
        windowsVerbatimArguments: false,
      }),
    )
    expect(unref).toHaveBeenCalled()
  })

  it("launches GitHub Desktop for an existing git workspace directory", async () => {
    const unref = vi.fn()
    const spawnProcess = vi.fn(() => ({
      once: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
        if (event === "spawn") {
          listener()
        }
        if (event === "close") {
          listener(0)
        }
      }),
      removeListener: vi.fn(),
      unref,
    }))

    const result = await openInExternalEditor(
      {
        editorID: "githubDesktop",
        targetPath: "C:\\Projects\\Atlas",
      },
      {
        platform: "win32",
        env: {
          LOCALAPPDATA: "C:\\Users\\demo\\AppData\\Local",
          SystemRoot: "C:\\Windows",
        },
        existsSync: (targetPath) =>
          [
            "C:\\Users\\demo\\AppData\\Local\\GitHubDesktop\\bin\\github.bat",
            "C:\\Users\\demo\\AppData\\Local\\GitHubDesktop\\GitHubDesktop.exe",
            "C:\\Projects\\Atlas\\.git",
          ].includes(targetPath),
        resolveCommand: (commandName) => (commandName === "github" ? "C:\\Users\\demo\\AppData\\Local\\GitHubDesktop\\bin\\github" : undefined),
        spawnProcess: spawnProcess as unknown as typeof import("node:child_process").spawn,
        statSync: ((_targetPath: string) =>
          ({
            isDirectory: () => true,
          }) as import("node:fs").Stats) as typeof import("node:fs").statSync,
      },
    )

    expect(result).toEqual({
      ok: true,
      editor: {
        id: "githubDesktop",
        label: "GitHub Desktop",
        executablePath: "C:\\Users\\demo\\AppData\\Local\\GitHubDesktop\\bin\\github.bat",
        iconPath: "C:\\Users\\demo\\AppData\\Local\\GitHubDesktop\\GitHubDesktop.exe",
      },
      targetPath: "C:\\Projects\\Atlas",
    })
    expect(spawnProcess).toHaveBeenCalledWith(
      "C:\\Windows\\System32\\cmd.exe",
      ["/d", "/s", "/c", "\"\"C:\\Users\\demo\\AppData\\Local\\GitHubDesktop\\bin\\github.bat\" \"C:\\Projects\\Atlas\""],
      expect.objectContaining({
        detached: true,
        shell: false,
        stdio: "ignore",
        windowsHide: true,
        windowsVerbatimArguments: true,
      }),
    )
    expect(unref).toHaveBeenCalled()
  })

  it("opens File Explorer through openPath when it is available", async () => {
    const openPath = vi.fn().mockResolvedValue("")
    const spawnProcess = vi.fn()

    const result = await openInExternalEditor(
      {
        editorID: "explorer",
        targetPath: "C:\\Projects\\Atlas",
      },
      {
        platform: "win32",
        env: {
          SystemRoot: "C:\\Windows",
        },
        existsSync: (targetPath) => ["C:\\Windows\\explorer.exe"].includes(targetPath),
        openPath,
        resolveCommand: (commandName) => (commandName === "explorer.exe" ? "C:\\Windows\\explorer.exe" : undefined),
        spawnProcess: spawnProcess as unknown as typeof import("node:child_process").spawn,
        statSync: ((_targetPath: string) =>
          ({
            isDirectory: () => true,
          }) as import("node:fs").Stats) as typeof import("node:fs").statSync,
      },
    )

    expect(result).toEqual({
      ok: true,
      editor: {
        id: "explorer",
        label: "File Explorer",
        executablePath: "C:\\Windows\\explorer.exe",
      },
      targetPath: "C:\\Projects\\Atlas",
    })
    expect(openPath).toHaveBeenCalledWith("C:\\Projects\\Atlas")
    expect(spawnProcess).not.toHaveBeenCalled()
  })

  it("launches Terminal through a start command for an existing workspace directory", async () => {
    const unref = vi.fn()
    const spawnProcess = vi.fn(() => ({
      once: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
        if (event === "spawn") {
          listener()
        }
        if (event === "close") {
          listener(0)
        }
      }),
      removeListener: vi.fn(),
      unref,
    }))

    const result = await openInExternalEditor(
      {
        editorID: "terminal",
        targetPath: "C:\\Projects\\Atlas",
      },
      {
        platform: "win32",
        env: {
          LOCALAPPDATA: "C:\\Users\\demo\\AppData\\Local",
          SystemRoot: "C:\\Windows",
        },
        existsSync: (targetPath) => ["C:\\Users\\demo\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe"].includes(targetPath),
        resolveCommand: (commandName) => (commandName === "wt" ? "C:\\Users\\demo\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe" : undefined),
        spawnProcess: spawnProcess as unknown as typeof import("node:child_process").spawn,
        statSync: ((_targetPath: string) =>
          ({
            isDirectory: () => true,
          }) as import("node:fs").Stats) as typeof import("node:fs").statSync,
      },
    )

    expect(result).toEqual({
      ok: true,
      editor: {
        id: "terminal",
        label: "Terminal",
        executablePath: "C:\\Users\\demo\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe",
      },
      targetPath: "C:\\Projects\\Atlas",
    })
    expect(spawnProcess).toHaveBeenCalledWith(
      "C:\\Windows\\System32\\cmd.exe",
      ["/d", "/s", "/c", "\"start \"\" \"C:\\Users\\demo\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe\" \"-d\" \"C:\\Projects\\Atlas\"\""],
      expect.objectContaining({
        detached: true,
        shell: false,
        stdio: "ignore",
        windowsHide: true,
        windowsVerbatimArguments: true,
      }),
    )
    expect(unref).toHaveBeenCalled()
  })

  it("launches a selected macOS app bundle for an existing workspace directory", async () => {
    const spawnProcess = vi.fn(() => ({
      once: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
        if (event === "close") {
          listener(0)
        }
      }),
      removeListener: vi.fn(),
      unref: vi.fn(),
    }))

    const result = await openInExternalEditor(
      {
        editorID: "cursor",
        targetPath: "/Users/demo/Atlas",
      },
      {
        platform: "darwin",
        existsSync: (targetPath) => ["/Applications/Cursor.app"].includes(targetPath),
        resolveCommand: () => undefined,
        spawnProcess: spawnProcess as unknown as typeof import("node:child_process").spawn,
        statSync: ((_targetPath: string) =>
          ({
            isDirectory: () => true,
          }) as import("node:fs").Stats) as typeof import("node:fs").statSync,
      },
    )

    expect(result).toEqual({
      ok: true,
      editor: {
        id: "cursor",
        label: "Cursor",
        executablePath: "/Applications/Cursor.app",
      },
      targetPath: "/Users/demo/Atlas",
    })
    expect(spawnProcess).toHaveBeenCalledWith(
      "/usr/bin/open",
      ["-a", "Cursor", "/Users/demo/Atlas"],
      expect.objectContaining({
        detached: true,
        shell: false,
        stdio: "ignore",
        windowsHide: true,
        windowsVerbatimArguments: false,
      }),
    )
  })

  it("rejects target-specific launchers when the workspace does not support them", async () => {
    await expect(
      Promise.resolve().then(() =>
        openInExternalEditor(
          {
            editorID: "githubDesktop",
            targetPath: "C:\\Projects\\Atlas",
          },
          {
            platform: "win32",
            existsSync: (targetPath) =>
              ["C:\\Users\\demo\\AppData\\Local\\GitHubDesktop\\bin\\github.bat", "C:\\Users\\demo\\AppData\\Local\\GitHubDesktop\\GitHubDesktop.exe"].includes(
                targetPath,
              ),
            resolveCommand: (commandName) => (commandName === "github" ? "C:\\Users\\demo\\AppData\\Local\\GitHubDesktop\\bin\\github" : undefined),
            statSync: ((_targetPath: string) =>
              ({
                isDirectory: () => true,
              }) as import("node:fs").Stats) as typeof import("node:fs").statSync,
          },
        ),
      ),
    ).rejects.toThrow("Editor 'githubDesktop' is not available.")
  })

  it("rejects when the spawned editor process fails to launch", async () => {
    const spawnProcess = vi.fn(() => ({
      once: vi.fn((event: string, listener: (error?: Error) => void) => {
        if (event === "error") {
          listener(new Error("spawn C:\\\\Users\\\\demo\\\\AppData\\\\Local\\\\Programs\\\\Microsoft VS Code\\\\bin\\\\code ENOENT"))
        }
      }),
      removeListener: vi.fn(),
      unref: vi.fn(),
    }))

    await expect(
      openInExternalEditor(
        {
          editorID: "vscode",
          targetPath: "C:\\Projects\\Atlas",
        },
        {
          platform: "win32",
          existsSync: (targetPath) =>
            [
              "C:\\Users\\demo\\AppData\\Local\\Programs\\Microsoft VS Code\\bin\\code.cmd",
              "C:\\Users\\demo\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe",
            ].includes(targetPath),
          resolveCommand: (commandName) => (commandName === "code" ? "C:\\Users\\demo\\AppData\\Local\\Programs\\Microsoft VS Code\\bin\\code" : undefined),
          spawnProcess: spawnProcess as unknown as typeof import("node:child_process").spawn,
          statSync: ((_targetPath: string) =>
            ({
              isDirectory: () => true,
            }) as import("node:fs").Stats) as typeof import("node:fs").statSync,
        },
      ),
    ).rejects.toThrow("Failed to launch VS Code")
  })
})
