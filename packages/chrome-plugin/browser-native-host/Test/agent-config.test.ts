import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"
import {
  agentBaseURL,
  DEFAULT_AGENT_BASE_URL,
  HOST_NAME,
  normalizeAgentBaseURL,
  readRuntimeConfigAgentBaseURL,
  runtimeConfigPathCandidates,
} from "../src/agent-config"

const tempDirectories: string[] = []

function tempDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "anybox-native-host-config-"))
  tempDirectories.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

describe("native host agent config", () => {
  test("normalizes http and https base URLs", () => {
    expect(normalizeAgentBaseURL(" http://127.0.0.1:58034/ ")).toBe("http://127.0.0.1:58034")
    expect(normalizeAgentBaseURL("https://localhost:4096")).toBe("https://localhost:4096")
    expect(normalizeAgentBaseURL("ws://127.0.0.1:4096")).toBeUndefined()
    expect(normalizeAgentBaseURL("not a url")).toBeUndefined()
  })

  test("prefers explicit environment over runtime config", () => {
    const directory = tempDirectory()
    const configPath = join(directory, `${HOST_NAME}.runtime.json`)
    writeFileSync(configPath, JSON.stringify({ agentBaseURL: "http://127.0.0.1:58034" }))

    expect(agentBaseURL({
      ANYBOX_AGENT_BASE_URL: "http://127.0.0.1:60000",
      ANYBOX_BROWSER_NATIVE_CONFIG: configPath,
    })).toBe("http://127.0.0.1:60000")
  })

  test("reads the explicit runtime config file", () => {
    const directory = tempDirectory()
    const configPath = join(directory, `${HOST_NAME}.runtime.json`)
    writeFileSync(configPath, JSON.stringify({ agentBaseURL: "http://127.0.0.1:58034/" }))

    expect(readRuntimeConfigAgentBaseURL({ ANYBOX_BROWSER_NATIVE_CONFIG: configPath })).toBe("http://127.0.0.1:58034")
  })

  test("discovers app data runtime config candidates", () => {
    const appData = tempDirectory()
    const configPath = join(appData, "anybox-desktop-agent", "native-messaging", `${HOST_NAME}.runtime.json`)
    mkdirSync(join(appData, "anybox-desktop-agent", "native-messaging"), { recursive: true })
    writeFileSync(configPath, JSON.stringify({ agentBaseURL: "http://127.0.0.1:58034" }))

    const candidates = runtimeConfigPathCandidates({ APPDATA: appData, HOME: tempDirectory() })
    expect(candidates).toContain(configPath)
    expect(agentBaseURL({ APPDATA: appData, HOME: tempDirectory() })).toBe("http://127.0.0.1:58034")
  })

  test("falls back to the legacy fixed port", () => {
    expect(agentBaseURL({ HOME: tempDirectory() })).toBe(DEFAULT_AGENT_BASE_URL)
  })
})
