import { existsSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const electronAppMock = vi.hoisted(() => ({
  paths: {
    userData: "",
  } as Record<string, string>,
}))

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn((name: string) => electronAppMock.paths[name] ?? ""),
  },
}))

import { AGENT_WORKDIR_ENV, resolveDefaultAgentWorkdir } from "./agent-workdir"

const tempDirectories: string[] = []
let previousWorkdir: string | undefined

beforeEach(async () => {
  previousWorkdir = process.env[AGENT_WORKDIR_ENV]
  delete process.env[AGENT_WORKDIR_ENV]

  const userData = await mkdtemp(path.join(os.tmpdir(), "anybox-agent-workdir-"))
  tempDirectories.push(userData)
  electronAppMock.paths.userData = userData
})

afterEach(async () => {
  if (previousWorkdir === undefined) {
    delete process.env[AGENT_WORKDIR_ENV]
  } else {
    process.env[AGENT_WORKDIR_ENV] = previousWorkdir
  }
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })))
})

describe("resolveDefaultAgentWorkdir", () => {
  it("uses a stable app data folder when no workdir is configured", () => {
    const directory = resolveDefaultAgentWorkdir()

    expect(directory).toBe(path.join(electronAppMock.paths.userData, "default-conversation"))
    expect(existsSync(directory)).toBe(true)
  })

  it("keeps an explicit agent workdir override", () => {
    const configuredDirectory = path.join(electronAppMock.paths.userData, "custom-workdir")
    process.env[AGENT_WORKDIR_ENV] = configuredDirectory

    expect(resolveDefaultAgentWorkdir()).toBe(configuredDirectory)
    expect(existsSync(configuredDirectory)).toBe(false)
  })
})
