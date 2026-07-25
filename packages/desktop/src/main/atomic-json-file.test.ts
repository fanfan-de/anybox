import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  preserveVersionedJsonBackup,
  writeJsonFileAtomic,
} from "./atomic-json-file"

let tempDirectory = ""

beforeEach(async () => {
  tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "anybox-atomic-json-"))
})

afterEach(async () => {
  await fs.rm(tempDirectory, { force: true, recursive: true })
})

describe("atomic JSON files", () => {
  it("replaces an existing document without leaving temporary artifacts", async () => {
    const filePath = path.join(tempDirectory, "appearance-theme.json")
    await writeJsonFileAtomic(filePath, { version: 1 })
    await writeJsonFileAtomic(filePath, { version: 2, nested: { ok: true } })

    await expect(fs.readFile(filePath, "utf8").then(JSON.parse)).resolves.toEqual({
      version: 2,
      nested: { ok: true },
    })
    await expect(fs.readdir(tempDirectory)).resolves.toEqual([
      "appearance-theme.json",
    ])
  })

  it("keeps the first versioned migration backup intact", async () => {
    const filePath = path.join(tempDirectory, "appearance-theme.json")
    await fs.writeFile(filePath, "{\"version\":1}\n", "utf8")

    const backupPath = await preserveVersionedJsonBackup(
      filePath,
      "{\"version\":1}\n",
      1,
    )
    await preserveVersionedJsonBackup(filePath, "{\"version\":1,\"later\":true}\n", 1)

    await expect(fs.readFile(backupPath, "utf8")).resolves.toBe(
      "{\"version\":1}\n",
    )
  })
})
