import { BrowserWindow, app } from "electron"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { readTrimmedDesktopEnv } from "./env-compat"
import { ensureManagedAgentRunning } from "./managed-agent"
import { safeError } from "./safe-console"

const DEFAULT_MONITOR_DEV_URL = "http://127.0.0.1:4174/"
const MONITOR_DEV_SERVER_TIMEOUT_MS = 500
const MONITOR_AGENT_BASE_URL_QUERY_PARAM = "agentBaseURL"
const MONITOR_HTML_MARKERS = ['name="anybox-app" content="monitor"', "Anybox backend monitor"]

type MonitorWindowTarget =
  | {
      source: "dev-server"
      url: string
    }
  | {
      filePath: string
      source: "file"
    }

let monitorWindow: BrowserWindow | null = null

function normalizeMonitorURL(value: string) {
  const trimmed = value.trim()
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`
}

export async function isMonitorDevServerAvailable(url: string) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), MONITOR_DEV_SERVER_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
    })
    if (!response.ok) return false

    const html = await response.text()
    return MONITOR_HTML_MARKERS.some((marker) => html.includes(marker))
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

function resolveMonitorIndexPath() {
  const mainDir = path.dirname(fileURLToPath(import.meta.url))
  const appPath = app.getAppPath()
  const resourcePath = process.resourcesPath
  const candidates = [
    path.join(resourcePath, "monitor", "index.html"),
    path.join(process.cwd(), "../monitor/dist/index.html"),
    path.join(process.cwd(), "packages/monitor/dist/index.html"),
    path.join(appPath, "../monitor/dist/index.html"),
    path.join(appPath, "packages/monitor/dist/index.html"),
    path.join(mainDir, "../../../monitor/dist/index.html"),
    path.join(mainDir, "../../../../monitor/dist/index.html"),
  ]

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null
}

async function resolveMonitorWindowTarget(): Promise<MonitorWindowTarget> {
  const devServerURL = normalizeMonitorURL(readTrimmedDesktopEnv("ANYBOX_MONITOR_URL") ?? DEFAULT_MONITOR_DEV_URL)

  if (!app.isPackaged && (await isMonitorDevServerAvailable(devServerURL))) {
    return {
      source: "dev-server",
      url: devServerURL,
    }
  }

  const filePath = resolveMonitorIndexPath()
  if (filePath) {
    return {
      filePath,
      source: "file",
    }
  }

  if (await isMonitorDevServerAvailable(devServerURL)) {
    return {
      source: "dev-server",
      url: devServerURL,
    }
  }

  throw new Error("Monitor UI was not found. Build packages/monitor or start the monitor dev server.")
}

function addAgentBaseURLQueryParam(url: string, baseURL: string | undefined) {
  if (!baseURL) return url

  const nextURL = new URL(url)
  nextURL.searchParams.set(MONITOR_AGENT_BASE_URL_QUERY_PARAM, baseURL)
  return nextURL.toString()
}

async function resolveMonitorAgentBaseURL() {
  try {
    return await ensureManagedAgentRunning()
  } catch (error) {
    safeError("[desktop][monitor] failed to resolve managed agent URL", error)
    return undefined
  }
}

export async function openMonitorWindow() {
  if (monitorWindow && !monitorWindow.isDestroyed()) {
    if (monitorWindow.isMinimized()) monitorWindow.restore()
    monitorWindow.show()
    monitorWindow.focus()

    return {
      ok: true as const,
      reused: true as const,
      source: "existing" as const,
    }
  }

  const target = await resolveMonitorWindowTarget()
  const agentBaseURL = await resolveMonitorAgentBaseURL()
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: "Anybox Monitor",
    autoHideMenuBar: true,
    backgroundColor: "#f8fafc",
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  monitorWindow = win
  win.on("closed", () => {
    if (monitorWindow === win) {
      monitorWindow = null
    }
  })
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
  win.once("ready-to-show", () => {
    if (!win.isDestroyed()) {
      win.show()
    }
  })

  try {
    if (target.source === "dev-server") {
      const monitorURL = addAgentBaseURLQueryParam(target.url, agentBaseURL)
      await win.loadURL(monitorURL)
      return {
        ok: true as const,
        reused: false as const,
        source: target.source,
        url: monitorURL,
      }
    }

    await win.loadFile(
      target.filePath,
      agentBaseURL ? { query: { [MONITOR_AGENT_BASE_URL_QUERY_PARAM]: agentBaseURL } } : undefined,
    )
    return {
      filePath: target.filePath,
      ok: true as const,
      reused: false as const,
      source: target.source,
    }
  } catch (error) {
    if (monitorWindow === win) {
      monitorWindow = null
    }
    if (!win.isDestroyed()) {
      win.destroy()
    }
    throw error
  }
}
