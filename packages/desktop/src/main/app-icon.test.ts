import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

const electronMock = vi.hoisted(() => ({
  app: {
    getAppPath: vi.fn(() => "C:\\Anybox\\resources\\app.asar"),
  },
}))

const fsMock = vi.hoisted(() => {
  const existingPaths = new Set<string>()
  return {
    existingPaths,
    existsSync: vi.fn((candidate: string) => existingPaths.has(candidate)),
  }
})

vi.mock("electron", () => ({
  app: electronMock.app,
}))

vi.mock("node:fs", () => ({
  default: {
    existsSync: fsMock.existsSync,
  },
  existsSync: fsMock.existsSync,
}))

import { resolveAppIconPath } from "./app-icon"

const processWithResources = process as NodeJS.Process & { resourcesPath?: string }
const originalResourcesPath = processWithResources.resourcesPath

function iconFileName() {
  return process.platform === "win32" ? "icon.ico" : "icon.png"
}

function setResourcesPath(resourcesPath: string | undefined) {
  if (resourcesPath === undefined) {
    Reflect.deleteProperty(processWithResources, "resourcesPath")
    return
  }

  Object.defineProperty(processWithResources, "resourcesPath", {
    configurable: true,
    value: resourcesPath,
    writable: true,
  })
}

describe("resolveAppIconPath", () => {
  afterEach(() => {
    fsMock.existingPaths.clear()
    fsMock.existsSync.mockClear()
    electronMock.app.getAppPath.mockReturnValue("C:\\Anybox\\resources\\app.asar")
    setResourcesPath(originalResourcesPath)
  })

  it("prefers the packaged icon resource", () => {
    const resourcesPath = "C:\\Anybox\\resources"
    const expectedPath = path.join(resourcesPath, "build", iconFileName())
    setResourcesPath(resourcesPath)
    fsMock.existingPaths.add(expectedPath)

    expect(resolveAppIconPath("C:\\Anybox\\resources\\app.asar\\out\\main")).toBe(expectedPath)
    expect(fsMock.existsSync).toHaveBeenCalledWith(expectedPath)
  })

  it("falls back to the development build icon when Electron resources are unavailable", () => {
    const expectedPath = path.join(process.cwd(), "build", iconFileName())
    setResourcesPath(undefined)
    fsMock.existingPaths.add(expectedPath)

    expect(resolveAppIconPath("C:\\Projects\\Anybox\\packages\\desktop\\out\\main")).toBe(expectedPath)
  })
})
