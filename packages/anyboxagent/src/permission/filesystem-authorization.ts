import { AsyncLocalStorage } from "node:async_hooks"

export type FilesystemAuthorization = {
  allowOutsideWorkspace: boolean
  paths: string[]
}

const storage = new AsyncLocalStorage<FilesystemAuthorization>()

export function runWithFilesystemAuthorization<T>(
  authorization: FilesystemAuthorization,
  operation: () => T,
): T {
  return storage.run(authorization, operation)
}

export function currentFilesystemAuthorization() {
  return storage.getStore()
}
