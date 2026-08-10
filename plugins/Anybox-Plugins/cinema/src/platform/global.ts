import os from "node:os"
import path from "node:path"

function defaultDataRoot() {
  if (process.platform === "win32") {
    return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "AnyboxCinema")
  }
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "AnyboxCinema")
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "anybox-cinema")
}

const initialData = process.env.ANYBOX_APP_DATA_DIR?.trim() || defaultDataRoot()

export const Path = {
  data: initialData,
  state: path.join(initialData, "state"),
  cache: process.env.ANYBOX_APP_CACHE_DIR?.trim() || path.join(initialData, "cache"),
  log: process.env.ANYBOX_APP_LOG_DIR?.trim() || path.join(initialData, "logs"),
}

export function configureRuntimePaths(input: { data: string; cache: string; log: string }) {
  Path.data = path.resolve(input.data)
  Path.state = path.join(Path.data, "state")
  Path.cache = path.resolve(input.cache)
  Path.log = path.resolve(input.log)
}
