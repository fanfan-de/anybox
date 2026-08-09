import fs from "node:fs/promises"
import { posix as path } from "node:path"
import { Client, type ConnectConfig, type ClientChannel, type FileEntryWithStats, type SFTPWrapper, type Stats } from "ssh2"
import { createSshWorkspaceUri, normalizeSshRemotePath, parseWorkspaceLocation } from "@anybox/shared"
import { ApiError } from "#server/error.ts"
import { getProfile, getProfilePassphrase, markProfileConnected, type SshProfile } from "#remote/ssh/profiles.ts"

export interface RemoteFileStat {
  isFile: boolean
  isDirectory: boolean
  isSymbolicLink: boolean
  size: number
  mtimeMs: number
  mode: number
}

export interface RemoteDirectoryEntry {
  name: string
  path: string
  uri: string
  type: "file" | "directory" | "other"
  size: number
  modifiedAt: number
}

export interface RemoteExecResult {
  command: string
  cwd: string
  exitCode: number
  stdout: string
  stderr: string
  stdoutTruncated: boolean
  stderrTruncated: boolean
  durationMs: number
}

interface CachedClient {
  client: Client
  ready: Promise<Client>
}

const clients = new Map<string, CachedClient>()

function statsToFileStat(stats: Stats): RemoteFileStat {
  return {
    isFile: stats.isFile(),
    isDirectory: stats.isDirectory(),
    isSymbolicLink: stats.isSymbolicLink(),
    size: stats.size,
    mtimeMs: stats.mtime * 1000,
    mode: stats.mode,
  }
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function toApiError(error: unknown, fallbackMessage: string) {
  if (error instanceof ApiError) return error
  if (error instanceof Error) return new ApiError(502, "SSH_ERROR", error.message || fallbackMessage)
  return new ApiError(502, "SSH_ERROR", fallbackMessage)
}

async function buildConnectConfig(profile: SshProfile): Promise<ConnectConfig> {
  const privateKey = await fs.readFile(profile.privateKeyPath)
  const passphrase = await getProfilePassphrase(profile.id)
  return {
    host: profile.host,
    port: profile.port,
    username: profile.username,
    privateKey,
    passphrase,
    readyTimeout: 20_000,
    keepaliveInterval: 30_000,
    keepaliveCountMax: 3,
  }
}

async function connect(profile: SshProfile) {
  const existing = clients.get(profile.id)
  if (existing) return existing.ready

  const client = new Client()
  const ready = new Promise<Client>(async (resolve, reject) => {
    const cleanup = () => {
      clients.delete(profile.id)
    }
    client.once("ready", async () => {
      await markProfileConnected(profile.id).catch(() => undefined)
      resolve(client)
    })
    client.once("error", (error) => {
      cleanup()
      reject(toApiError(error, "Unable to connect to SSH host"))
    })
    client.once("close", cleanup)

    try {
      client.connect(await buildConnectConfig(profile))
    } catch (error) {
      cleanup()
      reject(toApiError(error, "Unable to connect to SSH host"))
    }
  })

  clients.set(profile.id, { client, ready })
  return ready
}

async function getClient(profileID: string) {
  const profile = await getProfile(profileID)
  if (!profile) throw new ApiError(404, "SSH_PROFILE_NOT_FOUND", "SSH profile not found")
  return connect(profile)
}

async function withSftp<T>(profileID: string, fn: (sftp: SFTPWrapper) => Promise<T>): Promise<T> {
  const client = await getClient(profileID)
  const sftp = await new Promise<SFTPWrapper>((resolve, reject) => {
    client.sftp((error, nextSftp) => {
      if (error) reject(toApiError(error, "Unable to open SFTP session"))
      else resolve(nextSftp)
    })
  })

  try {
    return await fn(sftp)
  } finally {
    sftp.end()
  }
}

function sftpCall<T>(callback: (done: (error: Error | null | undefined, value: T) => void) => void) {
  return new Promise<T>((resolve, reject) => {
    callback((error, value) => {
      if (error) reject(toApiError(error, "SFTP operation failed"))
      else resolve(value)
    })
  })
}

export async function realpath(uriOrProfileID: string, remotePath?: string) {
  const location = remotePath === undefined ? parseWorkspaceLocation(uriOrProfileID) : undefined
  const profileID = location?.kind === "ssh" ? location.profileID : uriOrProfileID
  const targetPath = normalizeSshRemotePath(location?.kind === "ssh" ? location.remotePath : remotePath ?? "/")
  return withSftp(profileID, (sftp) =>
    sftpCall<string>((done) => {
      sftp.realpath(targetPath, done)
    }),
  )
}

export async function stat(uri: string): Promise<RemoteFileStat> {
  const location = parseWorkspaceLocation(uri)
  if (location.kind !== "ssh") throw new ApiError(400, "INVALID_WORKSPACE", "Expected SSH workspace URI")
  return withSftp(location.profileID, (sftp) =>
    sftpCall<Stats>((done) => {
      sftp.stat(location.remotePath, done)
    }).then(statsToFileStat),
  )
}

export async function exists(uri: string) {
  return stat(uri)
    .then(() => true)
    .catch(() => false)
}

export async function readFileBuffer(uri: string) {
  const location = parseWorkspaceLocation(uri)
  if (location.kind !== "ssh") throw new ApiError(400, "INVALID_WORKSPACE", "Expected SSH workspace URI")
  return withSftp(location.profileID, (sftp) =>
    sftpCall<Buffer>((done) => {
      sftp.readFile(location.remotePath, done)
    }),
  )
}

export async function readText(uri: string) {
  return (await readFileBuffer(uri)).toString("utf8")
}

export async function writeText(uri: string, content: string) {
  const location = parseWorkspaceLocation(uri)
  if (location.kind !== "ssh") throw new ApiError(400, "INVALID_WORKSPACE", "Expected SSH workspace URI")
  await mkdirp(createSshWorkspaceUri(location.profileID, path.dirname(location.remotePath)))
  await withSftp(location.profileID, (sftp) =>
    sftpCall<void>((done) => {
      sftp.writeFile(location.remotePath, content, "utf8", (error) => done(error, undefined))
    }),
  )
}

export async function rename(sourceUri: string, targetUri: string) {
  const source = parseWorkspaceLocation(sourceUri)
  const target = parseWorkspaceLocation(targetUri)
  if (source.kind !== "ssh" || target.kind !== "ssh" || source.profileID !== target.profileID) {
    throw new ApiError(400, "INVALID_WORKSPACE", "Expected SSH workspace URIs on the same profile")
  }
  await withSftp(source.profileID, (sftp) =>
    sftpCall<void>((done) => {
      sftp.rename(source.remotePath, target.remotePath, (error) => done(error, undefined))
    }),
  )
}

export async function unlink(uri: string) {
  const location = parseWorkspaceLocation(uri)
  if (location.kind !== "ssh") throw new ApiError(400, "INVALID_WORKSPACE", "Expected SSH workspace URI")
  await withSftp(location.profileID, (sftp) =>
    sftpCall<void>((done) => {
      sftp.unlink(location.remotePath, (error) => done(error, undefined))
    }),
  )
}

export async function mkdirp(uri: string) {
  const location = parseWorkspaceLocation(uri)
  if (location.kind !== "ssh") throw new ApiError(400, "INVALID_WORKSPACE", "Expected SSH workspace URI")
  const parts = normalizeSshRemotePath(location.remotePath).split("/").filter(Boolean)
  let current = ""

  await withSftp(location.profileID, async (sftp) => {
    for (const part of parts) {
      current = `${current}/${part}`
      const existsAlready = await sftpCall<Stats>((done) => sftp.stat(current, done)).catch(() => undefined)
      if (existsAlready?.isDirectory()) continue
      await sftpCall<void>((done) => sftp.mkdir(current, (error) => done(error, undefined)))
    }
  })
}

function entryType(entry: FileEntryWithStats): RemoteDirectoryEntry["type"] {
  if (entry.attrs.isDirectory()) return "directory"
  if (entry.attrs.isFile()) return "file"
  return "other"
}

export async function listDirectory(uri: string): Promise<RemoteDirectoryEntry[]> {
  const location = parseWorkspaceLocation(uri)
  if (location.kind !== "ssh") throw new ApiError(400, "INVALID_WORKSPACE", "Expected SSH workspace URI")
  const entries = await withSftp(location.profileID, (sftp) =>
    sftpCall<FileEntryWithStats[]>((done) => {
      sftp.readdir(location.remotePath, done)
    }),
  )

  return entries
    .filter((entry) => entry.filename !== "." && entry.filename !== "..")
    .map((entry) => {
      const remotePath = normalizeSshRemotePath(path.join(location.remotePath, entry.filename))
      return {
        name: entry.filename,
        path: remotePath,
        uri: createSshWorkspaceUri(location.profileID, remotePath),
        type: entryType(entry),
        size: entry.attrs.size,
        modifiedAt: entry.attrs.mtime * 1000,
      }
    })
    .sort((a, b) => {
      if (a.type === b.type) return a.name.localeCompare(b.name)
      if (a.type === "directory") return -1
      if (b.type === "directory") return 1
      return a.name.localeCompare(b.name)
    })
}

export async function exec(profileID: string, cwd: string, command: string, options: { timeoutMs?: number; maxOutputChars?: number } = {}) {
  const client = await getClient(profileID)
  const started = Date.now()
  const timeoutMs = options.timeoutMs ?? 60_000
  const maxOutputChars = options.maxOutputChars ?? 200_000
  const wrappedCommand = `cd ${shellQuote(normalizeSshRemotePath(cwd))} && ${command}`

  return await new Promise<RemoteExecResult>((resolve, reject) => {
    let stdout = ""
    let stderr = ""
    let stdoutTruncated = false
    let stderrTruncated = false
    let settled = false
    let streamRef: ClientChannel | undefined
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      streamRef?.close()
      reject(new ApiError(408, "SSH_COMMAND_TIMEOUT", "SSH command timed out"))
    }, timeoutMs)

    client.exec(`sh -lc ${shellQuote(wrappedCommand)}`, (error, stream) => {
      if (error) {
        clearTimeout(timer)
        reject(toApiError(error, "Unable to execute SSH command"))
        return
      }

      streamRef = stream
      stream.on("data", (chunk: Buffer) => {
        const next = `${stdout}${chunk.toString("utf8")}`
        stdoutTruncated ||= next.length > maxOutputChars
        stdout = next.slice(-maxOutputChars)
      })
      stream.stderr.on("data", (chunk: Buffer) => {
        const next = `${stderr}${chunk.toString("utf8")}`
        stderrTruncated ||= next.length > maxOutputChars
        stderr = next.slice(-maxOutputChars)
      })
      stream.on("close", (code: number | null) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve({
          command,
          cwd: normalizeSshRemotePath(cwd),
          exitCode: code ?? 0,
          stdout,
          stderr,
          stdoutTruncated,
          stderrTruncated,
          durationMs: Date.now() - started,
        })
      })
    })
  })
}

export async function testConnection(profileID: string) {
  const profile = await getProfile(profileID)
  if (!profile) throw new ApiError(404, "SSH_PROFILE_NOT_FOUND", "SSH profile not found")
  const resolvedPath = await realpath(profileID, profile.defaultRemotePath)
  return {
    ok: true,
    profileID,
    remotePath: resolvedPath,
  }
}

export function closeProfileConnection(profileID: string) {
  const cached = clients.get(profileID)
  if (!cached) return
  cached.client.end()
  clients.delete(profileID)
}
