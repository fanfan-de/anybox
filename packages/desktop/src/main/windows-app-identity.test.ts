import { describe, expect, it } from "vitest"
import {
  DEVELOPMENT_WINDOWS_APP_USER_MODEL_ID,
  PACKAGED_WINDOWS_APP_USER_MODEL_ID,
  resolveWindowsAppUserModelId,
} from "./windows-app-identity"

describe("resolveWindowsAppUserModelId", () => {
  it("keeps the stable application identity for packaged Windows builds", () => {
    expect(resolveWindowsAppUserModelId(true, "win32")).toBe(PACKAGED_WINDOWS_APP_USER_MODEL_ID)
  })

  it("isolates Electron development sessions from the packaged application identity", () => {
    expect(resolveWindowsAppUserModelId(false, "win32")).toBe(DEVELOPMENT_WINDOWS_APP_USER_MODEL_ID)
    expect(DEVELOPMENT_WINDOWS_APP_USER_MODEL_ID).not.toBe(PACKAGED_WINDOWS_APP_USER_MODEL_ID)
  })

  it("does not assign a Windows application identity on other platforms", () => {
    expect(resolveWindowsAppUserModelId(true, "darwin")).toBeUndefined()
    expect(resolveWindowsAppUserModelId(false, "linux")).toBeUndefined()
  })
})
