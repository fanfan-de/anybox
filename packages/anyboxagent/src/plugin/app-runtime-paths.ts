import path from "node:path"
import { getProcessEnvValue } from "#env/compat.ts"
import * as Global from "#global/global.ts"

/** Stable per-plugin directories shared by the App Runtime and plugin-owned MCP processes. */
export function appRuntimeDirectories(pluginID: string) {
  const testHome = getProcessEnvValue("ANYBOX_TEST_HOME")?.trim()
  if (testHome) {
    const runtimeRoot = path.join(testHome, "plugin-app-runtimes", pluginID)
    return {
      cache: path.join(runtimeRoot, "cache"),
      data: path.join(runtimeRoot, "data"),
      log: path.join(runtimeRoot, "log"),
    }
  }
  const runtimeRoot = path.join(Global.Path.data, "plugins", "app-runtimes", pluginID)
  return {
    cache: path.join(Global.Path.cache, "plugins", "app-runtimes", pluginID),
    data: path.join(runtimeRoot, "data"),
    log: path.join(Global.Path.log, "plugins", "app-runtimes", pluginID),
  }
}
