import { spawn, spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const AGENT_LOG_LEVELS = new Set(["DEBUG", "INFO", "WARN", "ERROR"])
const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(scriptDir, "..")
const repoRoot = path.resolve(packageRoot, "..", "..")

function appendNodePath(...entries) {
  const separator = process.platform === "win32" ? ";" : ":"
  process.env.NODE_PATH = [
    ...entries,
    ...(process.env.NODE_PATH ? process.env.NODE_PATH.split(separator) : []),
  ].filter(Boolean).join(separator)
}

appendNodePath(path.join(packageRoot, "node_modules"), path.join(repoRoot, "node_modules"))

function writeAgentLogLevel(level) {
  process.env.ANYBOX_LOG_LEVEL = level
}

function printHelp() {
  console.log(`Usage: npm run dev -- [options]

Options:
  --agent-log-level <level>    Filter managed agent logs: DEBUG, INFO, WARN, ERROR.
  --agent-log-level=<level>    Same as above.
  --help                      Show this help.
`)
}

function configureAgentLogging(args) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]

    if (arg === "--help" || arg === "-h") {
      printHelp()
      process.exit(0)
    }

    let level
    if (arg === "--agent-log-level") {
      level = args[index + 1]
      index += 1
    } else if (arg.startsWith("--agent-log-level=")) {
      level = arg.slice("--agent-log-level=".length)
    } else {
      continue
    }

    const normalizedLevel = level?.trim().toUpperCase()
    if (!normalizedLevel || !AGENT_LOG_LEVELS.has(normalizedLevel)) {
      console.error(`Invalid --agent-log-level value: ${level ?? ""}`)
      console.error("Expected one of: DEBUG, INFO, WARN, ERROR")
      process.exit(1)
    }

    writeAgentLogLevel(normalizedLevel)
  }
}

configureAgentLogging(process.argv.slice(2))
process.env.ANYBOX_DESKTOP_DEVELOPMENT_FEATURES = "1"
if (!process.env.ANYBOX_PLUGIN_LOCAL_DIR?.trim()) {
  process.env.ANYBOX_PLUGIN_LOCAL_DIR = path.join(repoRoot, "plugins", "Anybox-Plugins")
}

function ensureAppIcons() {
  const result = spawnSync(process.execPath, [path.join(scriptDir, "generate-app-icons.mjs")], {
    stdio: "inherit",
    shell: false,
    windowsHide: false,
  })

  if (!result.error && result.status === 0) return

  if (process.platform !== "darwin" && process.platform !== "win32") {
    console.warn("[desktop][icons] icon generation failed; continuing with the platform default icon.")
    if (result.error) console.warn(result.error)
    return
  }

  if (result.error) {
    console.error(result.error)
    process.exit(1)
  }

  process.exit(result.status ?? 1)
}

ensureAppIcons()

const command =
  process.platform === "win32"
    ? {
        file: "cmd.exe",
        args: ["/d", "/s", "/c", "chcp 65001 > nul && electron-vite dev"],
      }
    : {
        file: "electron-vite",
        args: ["dev"],
      }

const child = spawn(command.file, command.args, {
  stdio: "inherit",
  shell: false,
  windowsHide: false,
})

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }

  process.exit(code ?? 0)
})

child.on("error", (error) => {
  console.error(error)
  process.exit(1)
})
