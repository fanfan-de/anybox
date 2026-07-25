import { randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

export async function writeJsonFileAtomic(filePath: string, value: unknown) {
  const directory = path.dirname(filePath)
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  )
  const rollbackPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.rollback`,
  )
  const contents = `${JSON.stringify(value, null, 2)}\n`

  await fs.mkdir(directory, { recursive: true })
  const handle = await fs.open(temporaryPath, "wx")
  try {
    await handle.writeFile(contents, "utf8")
    await handle.sync()
  } finally {
    await handle.close()
  }

  try {
    await fs.rename(temporaryPath, filePath)
    return
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== "EEXIST" && code !== "EPERM") {
      await fs.rm(temporaryPath, { force: true })
      throw error
    }
  }

  let movedExistingFile = false
  try {
    await fs.rename(filePath, rollbackPath)
    movedExistingFile = true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      await fs.rm(temporaryPath, { force: true })
      throw error
    }
  }

  try {
    await fs.rename(temporaryPath, filePath)
    if (movedExistingFile) await fs.rm(rollbackPath, { force: true })
  } catch (error) {
    if (movedExistingFile) {
      await fs.rename(rollbackPath, filePath)
    }
    await fs.rm(temporaryPath, { force: true })
    throw error
  }
}

export async function preserveVersionedJsonBackup(
  filePath: string,
  raw: string,
  version: number,
) {
  const parsed = path.parse(filePath)
  const backupPath = path.join(
    parsed.dir,
    `${parsed.name}.v${version}.backup${parsed.ext || ".json"}`,
  )

  try {
    await fs.writeFile(backupPath, raw, { encoding: "utf8", flag: "wx" })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
  }

  return backupPath
}
