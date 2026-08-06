import { describe, expect, it } from "vitest"
import {
  DEFAULT_SHELL_LAYOUT_MODE,
  SHELL_LAYOUT_MODE_STORAGE_KEY,
  getShellRegionRole,
  normalizeShellLayoutMode,
  readShellLayoutMode,
} from "./shell-layout"

describe("shell layout", () => {
  it("normalizes persisted values and falls back safely", () => {
    expect(normalizeShellLayoutMode("tools-primary")).toBe("tools-primary")
    expect(normalizeShellLayoutMode("workbench-primary")).toBe("workbench-primary")
    expect(normalizeShellLayoutMode("unknown")).toBe(DEFAULT_SHELL_LAYOUT_MODE)
    expect(readShellLayoutMode(null)).toBe(DEFAULT_SHELL_LAYOUT_MODE)
    expect(readShellLayoutMode({ getItem: () => "tools-primary" })).toBe("tools-primary")
    expect(readShellLayoutMode({
      getItem: (key) => {
        expect(key).toBe(SHELL_LAYOUT_MODE_STORAGE_KEY)
        throw new Error("storage unavailable")
      },
    })).toBe(DEFAULT_SHELL_LAYOUT_MODE)
  })

  it("maps both surfaces to a single primary and companion region", () => {
    expect(getShellRegionRole("workbench-primary", "workbench")).toBe("primary")
    expect(getShellRegionRole("workbench-primary", "tools")).toBe("companion")
    expect(getShellRegionRole("tools-primary", "tools")).toBe("primary")
    expect(getShellRegionRole("tools-primary", "workbench")).toBe("companion")
  })
})
