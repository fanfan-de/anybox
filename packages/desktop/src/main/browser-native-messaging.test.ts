import { describe, expect, it, vi } from "vitest"

vi.mock("electron", () => ({
  app: {
    get isPackaged() {
      return false
    },
    getAppPath: vi.fn(() => "C:\\Projects\\anybox\\packages\\desktop"),
    getPath: vi.fn(() => "C:\\Users\\tester\\AppData\\Roaming\\Anybox"),
  },
}))

import {
  BROWSER_NATIVE_HOST_NAME,
  browserNativeMessagingRuntimeConfig,
  browserNativeMessagingManifest,
  browserNativeMessagingRegistryKey,
  BROWSER_NATIVE_RUNTIME_CONFIG_FILENAME,
  DEFAULT_BROWSER_EXTENSION_ID,
  resolveBrowserNativeMessagingRuntimeConfigPath,
} from "./browser-native-messaging"

function toWindowsSeparators(value: string) {
  return value.replaceAll("/", "\\")
}

describe("browser native messaging registration helpers", () => {
  it("builds a Chrome native messaging manifest", () => {
    const manifest = browserNativeMessagingManifest({
      hostPath: "C:\\Anybox\\anybox-chrome-native-host.exe",
    })

    expect(manifest).toEqual({
      name: BROWSER_NATIVE_HOST_NAME,
      description: "Anybox Chrome Native Messaging Host",
      path: "C:\\Anybox\\anybox-chrome-native-host.exe",
      type: "stdio",
      allowed_origins: [`chrome-extension://${DEFAULT_BROWSER_EXTENSION_ID}/`],
    })
  })

  it("uses the HKCU Chrome NativeMessagingHosts registry key", () => {
    expect(browserNativeMessagingRegistryKey()).toBe(
      `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${BROWSER_NATIVE_HOST_NAME}`,
    )
  })

  it("builds a runtime discovery config for the current agent URL", () => {
    const config = browserNativeMessagingRuntimeConfig({
      agentBaseURL: "http://127.0.0.1:58034/",
    })

    expect(config).toEqual({
      agentBaseURL: "http://127.0.0.1:58034",
      updatedAt: expect.any(String),
    })
  })

  it("stores the runtime config next to the native messaging manifest", () => {
    expect(toWindowsSeparators(resolveBrowserNativeMessagingRuntimeConfigPath())).toBe(
      `C:\\Users\\tester\\AppData\\Roaming\\Anybox\\native-messaging\\${BROWSER_NATIVE_RUNTIME_CONFIG_FILENAME}`,
    )
  })
})
