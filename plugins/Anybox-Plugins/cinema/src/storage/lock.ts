import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises"
import { readFileSync, rmSync } from "node:fs"
import path from "node:path"
import * as Global from "#global/global.ts"

const STALE_AFTER_MS = 30_000
const ACQUIRE_TIMEOUT_MS = 30_000
const HEARTBEAT_MS = 5_000

type LockOwner = {
  token: string
  pid: number
  startedAt: number
  keyHash: string
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function lockPathFor(key: string) {
  const digest = createHash("sha256").update(key).digest("hex")
  const normalizedKey = key.replaceAll("/", path.sep)
  const projectMarker = `${path.sep}.anybox-cinema`
  const markerIndex = normalizedKey.toLowerCase().indexOf(projectMarker.toLowerCase())
  const throughMarker = markerIndex >= 0
    ? normalizedKey.slice(0, markerIndex + projectMarker.length)
    : undefined
  const absoluteStart = throughMarker === undefined
    ? -1
    : process.platform === "win32"
      ? (() => {
          const drive = throughMarker.search(/[A-Za-z]:\\/u)
          if (drive >= 0) return drive
          return throughMarker.indexOf("\\\\")
        })()
      : throughMarker.indexOf(path.sep)
  const projectMetadataRoot = throughMarker && absoluteStart >= 0
    ? throughMarker.slice(absoluteStart)
    : undefined
  const lockRoot = projectMetadataRoot && path.isAbsolute(projectMetadataRoot)
    ? path.join(projectMetadataRoot, ".locks")
    : path.join(Global.Path.state, ".locks")
  return { digest, lockPath: path.join(lockRoot, `${digest}.lock`) }
}

function processAlive(pid: number) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function recoverStaleLock(lockPath: string) {
  const info = await stat(lockPath).catch(() => undefined)
  if (!info || Date.now() - info.mtimeMs <= STALE_AFTER_MS) return false
  const owner = await readFile(path.join(lockPath, "owner.json"), "utf8")
    .then((text) => JSON.parse(text) as Partial<LockOwner>)
    .catch(() => undefined)
  if (owner?.pid && processAlive(owner.pid)) return false
  await rm(lockPath, { recursive: true, force: true })
  return true
}

async function acquire(key: string): Promise<Disposable> {
  const { digest, lockPath } = lockPathFor(key)
  await mkdir(path.dirname(lockPath), { recursive: true })
  const deadline = Date.now() + ACQUIRE_TIMEOUT_MS
  const owner: LockOwner = { token: randomUUID(), pid: process.pid, startedAt: Date.now(), keyHash: digest }

  while (true) {
    try {
      await mkdir(lockPath)
      await writeFile(path.join(lockPath, "owner.json"), `${JSON.stringify(owner)}\n`, { flag: "wx" })
      break
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined
      if (code !== "EEXIST") {
        await rm(lockPath, { recursive: true, force: true }).catch(() => undefined)
        throw error
      }
      await recoverStaleLock(lockPath)
      if (Date.now() >= deadline) throw new Error(`Timed out acquiring Cinema lock '${digest}'.`)
      await sleep(50 + Math.floor(Math.random() * 50))
    }
  }

  const heartbeat = setInterval(() => {
    const now = new Date()
    void utimes(lockPath, now, now).catch(() => undefined)
  }, HEARTBEAT_MS)
  heartbeat.unref?.()
  let released = false

  return {
    [Symbol.dispose]() {
      if (released) return
      released = true
      clearInterval(heartbeat)
      try {
        const current = JSON.parse(readFileSync(path.join(lockPath, "owner.json"), "utf8")) as LockOwner
        if (current.token === owner.token) rmSync(lockPath, { recursive: true, force: true })
      } catch {
        // Ownership changed or the lock was already recovered.
      }
    },
  }
}

// Cinema mutations use one cross-process exclusive lease for both read and
// write operations. This is intentionally conservative and prevents the MCP
// process from racing the Web Runtime.
export async function read(key: string) {
  return await acquire(key)
}

export async function write(key: string) {
  return await acquire(key)
}
