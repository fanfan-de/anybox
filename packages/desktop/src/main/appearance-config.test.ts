import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  appearanceTokenValueToCss,
  parseAppearanceColorLiteral,
} from "../shared/appearance-color"
import { createDefaultAppearanceConfigDocument } from "../shared/appearance"

const userDataPathMock = vi.hoisted(() => ({
  value: "",
}))

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => userDataPathMock.value),
  },
}))

import {
  readAppearanceConfigSnapshot,
  writeAppearanceConfigSnapshot,
} from "./appearance-config"

let tempDirectory = ""

function literal(value: string) {
  const result = parseAppearanceColorLiteral(value)
  if (!result) throw new Error(`Invalid test color: ${value}`)
  return result
}

beforeEach(async () => {
  tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "anybox-appearance-config-"))
  userDataPathMock.value = tempDirectory
})

afterEach(async () => {
  await fs.rm(tempDirectory, { force: true, recursive: true })
})

describe("appearance config persistence", () => {
  it("returns a schema v2 default when the file does not exist", async () => {
    await expect(readAppearanceConfigSnapshot()).resolves.toMatchObject({
      exists: false,
      document: {
        version: 2,
        overrides: {},
        foreignDtcg: {},
      },
    })
  })

  it("backs up and atomically migrates a v1 document", async () => {
    const filePath = path.join(tempDirectory, "appearance-theme.json")
    const legacy = {
      version: 1,
      brandTheme: "sage",
      colorMode: "dark",
      fontFamily: "default",
      overrides: {
        "surface-app-light": " #123456 ",
      },
      resolvedTokens: {
        "surface-app-light": "#ffffff",
      },
      updatedAt: 42,
    }
    const raw = `${JSON.stringify(legacy, null, 2)}\n`
    await fs.writeFile(filePath, raw, "utf8")

    const snapshot = await readAppearanceConfigSnapshot()

    expect(snapshot.document.version).toBe(2)
    expect(snapshot.document).not.toHaveProperty("resolvedTokens")
    expect(appearanceTokenValueToCss(
      snapshot.document.overrides["surface-app-light"]!,
    )).toBe("#123456")
    await expect(fs.readFile(
      path.join(tempDirectory, "appearance-theme.v1.backup.json"),
      "utf8",
    )).resolves.toBe(raw)
    await expect(fs.readFile(filePath, "utf8").then(JSON.parse)).resolves.toMatchObject({
      version: 2,
      foreignDtcg: {},
    })
  })

  it("does not replace corrupt or structurally invalid v2 files", async () => {
    const filePath = path.join(tempDirectory, "appearance-theme.json")
    await fs.writeFile(filePath, "{not-json", "utf8")
    await expect(readAppearanceConfigSnapshot()).rejects.toThrow()
    await expect(fs.readFile(filePath, "utf8")).resolves.toBe("{not-json")

    const invalid = {
      ...createDefaultAppearanceConfigDocument(),
      overrides: {
        unknown: literal("#ffffff"),
      },
    }
    await fs.writeFile(filePath, `${JSON.stringify(invalid)}\n`, "utf8")
    await expect(readAppearanceConfigSnapshot()).rejects.toThrow(
      /Unknown appearance token/,
    )
  })

  it("rejects alias cycles before writing", async () => {
    const input = {
      ...createDefaultAppearanceConfigDocument(),
      overrides: {
        "surface-app-light": {
          type: "alias" as const,
          token: "surface-panel-light",
        },
        "surface-panel-light": {
          type: "alias" as const,
          token: "surface-app-light",
        },
      },
    }

    await expect(writeAppearanceConfigSnapshot(input)).rejects.toThrow(
      /alias cycle/i,
    )
    await expect(fs.readdir(tempDirectory)).resolves.toEqual([])
  })
})
