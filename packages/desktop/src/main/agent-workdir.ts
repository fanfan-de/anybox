import { app } from "electron"
import fs from "node:fs"
import path from "node:path"
import { readTrimmedDesktopEnv } from "./env-compat"

export const AGENT_WORKDIR_ENV = "ANYBOX_AGENT_WORKDIR"
const DEFAULT_CONVERSATION_DIRECTORY_NAME = "default-conversation"

export function resolveDefaultAgentWorkdir(options?: { ensureExists?: boolean }) {
  const configuredDirectory = readTrimmedDesktopEnv(AGENT_WORKDIR_ENV)
  if (configuredDirectory) return configuredDirectory

  const directory = path.join(app.getPath("userData"), DEFAULT_CONVERSATION_DIRECTORY_NAME)
  if (options?.ensureExists !== false) {
    fs.mkdirSync(directory, { recursive: true })
  }
  return directory
}
