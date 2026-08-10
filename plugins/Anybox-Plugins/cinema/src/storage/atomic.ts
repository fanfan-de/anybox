import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"

export async function readJsonFile<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T
}

export async function atomicWriteFile(file: string, content: string | Uint8Array) {
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${randomUUID()}.tmp`)
  await writeFile(temporary, content)
  await rename(temporary, file)
}

export async function atomicWriteJson(file: string, value: unknown) {
  await atomicWriteFile(file, `${JSON.stringify(value, null, 2)}\n`)
}
