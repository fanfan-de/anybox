import { describe, expect, it } from "vitest"
import { detectInstallerPlatform, normalizeVersionLabel } from "./releaseDownloads"

describe("release download helpers", () => {
  it("normalizes release tags", () => {
    expect(normalizeVersionLabel("desktop-v1.2.3")).toBe("v1.2.3")
    expect(normalizeVersionLabel("v0.2.4-beta.1")).toBe("v0.2.4-beta.1")
    expect(normalizeVersionLabel("  ")).toBeUndefined()
  })

  it("detects supported platforms without confusing Android and Linux", () => {
    expect(detectInstallerPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("windows")
    expect(detectInstallerPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("mac")
    expect(detectInstallerPlatform("Mozilla/5.0 (X11; Linux x86_64)")).toBe("linux")
    expect(detectInstallerPlatform("Mozilla/5.0 (Linux; Android 15)")).toBe("mobile")
    expect(detectInstallerPlatform("unknown device")).toBeUndefined()
  })
})
