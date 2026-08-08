import { createHash } from "node:crypto"
import fs from "node:fs"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import * as Global from "#global/global.ts"
import { getProcessEnvValue } from "#env/compat.ts"
import { IpythonRuntimeError } from "#ipython/types.ts"

const IPYTHON_PYTHON_ENV = "ANYBOX_IPYTHON_PYTHON"
const IPYTHON_ALLOW_SYSTEM_PYTHON_ENV = "ANYBOX_IPYTHON_ALLOW_SYSTEM_PYTHON"
const IPYTHON_HOST_SOURCE_ENV = "ANYBOX_IPYTHON_HOST_SOURCE"
const WORKSPACE_DEPENDENCIES_DIR_ENV = "ANYBOX_WORKSPACE_DEPENDENCIES_DIR"

export interface IpythonPythonRuntime {
  executable: string
  source: "override" | "bundled" | "system"
  commandArgs: string[]
  hostSourceRoot?: string
}

function bundledPythonExecutable(dependenciesRoot: string) {
  const pythonRoot = path.join(dependenciesRoot, "python")
  if (process.platform === "win32") return path.join(pythonRoot, "python.exe")

  const python3 = path.join(pythonRoot, "bin", "python3")
  if (fs.existsSync(python3)) return python3
  return path.join(pythonRoot, "bin", "python")
}

function looksLikePath(value: string) {
  return path.isAbsolute(value) || value.includes("/") || value.includes("\\")
}

function existingHostSourceRoot() {
  const configured = getProcessEnvValue(IPYTHON_HOST_SOURCE_ENV)?.trim()
  const candidate = configured || path.resolve(
    import.meta.dir,
    "../../python/anybox_ipython_host/src",
  )
  return fs.existsSync(path.join(candidate, "anybox_ipython_host", "__main__.py"))
    ? candidate
    : undefined
}

function hostCommandArgs(hostSourceRoot?: string) {
  if (!hostSourceRoot) return ["-I", "-u", "-m", "anybox_ipython_host"]

  return [
    "-I",
    "-u",
    "-c",
    [
      "import runpy, sys",
      "source_root = sys.argv[1]",
      "sys.argv = ['anybox_ipython_host']",
      "sys.path.insert(0, source_root)",
      "runpy.run_module('anybox_ipython_host', run_name='__main__')",
    ].join("; "),
    hostSourceRoot,
  ]
}

export function resolveIpythonPythonRuntime(): IpythonPythonRuntime {
  const hostSourceRoot = existingHostSourceRoot()
  const configured = getProcessEnvValue(IPYTHON_PYTHON_ENV)?.trim()
  if (configured) {
    if (looksLikePath(configured) && !fs.existsSync(configured)) {
      throw new IpythonRuntimeError(
        "IPYTHON_PYTHON_MISSING",
        `Configured IPython Python executable does not exist: ${configured}`,
      )
    }
    return {
      executable: configured,
      source: "override",
      commandArgs: hostCommandArgs(hostSourceRoot),
      hostSourceRoot,
    }
  }

  const dependenciesRoot = getProcessEnvValue(WORKSPACE_DEPENDENCIES_DIR_ENV)?.trim()
  if (dependenciesRoot) {
    const executable = bundledPythonExecutable(dependenciesRoot)
    if (!fs.existsSync(executable)) {
      throw new IpythonRuntimeError(
        "IPYTHON_PYTHON_MISSING",
        `Anybox's bundled Python executable is missing: ${executable}. Repair or reinstall Anybox.`,
      )
    }
    return {
      executable,
      source: "bundled",
      commandArgs: hostCommandArgs(),
    }
  }

  if (getProcessEnvValue(IPYTHON_ALLOW_SYSTEM_PYTHON_ENV) === "1") {
    const executable = process.platform === "win32" ? "python" : "python3"
    return {
      executable,
      source: "system",
      commandArgs: hostCommandArgs(hostSourceRoot),
      hostSourceRoot,
    }
  }

  throw new IpythonRuntimeError(
    "IPYTHON_RUNTIME_NOT_CONFIGURED",
    [
      "Anybox's managed IPython runtime is not configured.",
      `Set ${IPYTHON_PYTHON_ENV} only for development, or prepare the bundled workspace dependencies.`,
    ].join(" "),
  )
}

function safeSessionSegment(sessionID: string) {
  const slug = sessionID
    .normalize("NFKC")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
  const digest = createHash("sha256").update(sessionID).digest("hex").slice(0, 12)
  return `${slug || "session"}-${digest}`
}

export function getIpythonRuntimeCacheDir(input: { sessionID: string; generation: number }) {
  return path.join(
    Global.Path.cache,
    "ipython",
    safeSessionSegment(input.sessionID),
    `generation-${input.generation}`,
  )
}

export async function prepareIpythonRuntimeEnvironment(input: {
  sessionID: string
  generation: number
}): Promise<{ cacheDir: string; env: NodeJS.ProcessEnv }> {
  const cacheDir = getIpythonRuntimeCacheDir(input)
  const jupyterConfigDir = path.join(cacheDir, "jupyter-config")
  const jupyterDataDir = path.join(cacheDir, "jupyter-data")
  const ipythonDir = path.join(cacheDir, "profile")
  await Promise.all([
    mkdir(cacheDir, { recursive: true }),
    mkdir(jupyterConfigDir, { recursive: true }),
    mkdir(jupyterDataDir, { recursive: true }),
    mkdir(ipythonDir, { recursive: true }),
  ])

  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    const normalized = key.toUpperCase()
    if (
      normalized.startsWith("PYTHON")
      || normalized.startsWith("JUPYTER")
      || normalized.startsWith("IPYTHON")
    ) {
      delete env[key]
    }
  }

  return {
    cacheDir,
    env: {
      ...env,
      PYTHONNOUSERSITE: "1",
      PYTHONDONTWRITEBYTECODE: "1",
      PYTHONUTF8: "1",
      PIP_DISABLE_PIP_VERSION_CHECK: "1",
      JUPYTER_CONFIG_DIR: jupyterConfigDir,
      JUPYTER_DATA_DIR: jupyterDataDir,
      IPYTHONDIR: ipythonDir,
    },
  }
}
