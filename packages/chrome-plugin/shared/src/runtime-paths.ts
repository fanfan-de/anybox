import os from "node:os"
import path from "node:path"

export const BROWSER_HOST_RUNTIME_BOOTSTRAP_FILENAME =
  "com.anybox.browser.runtime-host.json"

export function browserRuntimePaths(
  env: NodeJS.ProcessEnv = process.env,
  home = env.ANYBOX_TEST_HOME?.trim() || os.homedir(),
) {
  const resolvedHome = path.resolve(home)
  const managedDataDir = env.ANYBOX_AGENT_DATA_DIR?.trim()
  const stateHome = env.XDG_STATE_HOME?.trim()
    ? path.resolve(env.XDG_STATE_HOME)
    : path.join(resolvedHome, ".local", "state")
  const state = managedDataDir
    ? path.join(path.resolve(managedDataDir), "state")
    : path.join(stateHome, "anybox")
  return {
    home: resolvedHome,
    state,
    browserIpc: path.join(state, "browser-ipc"),
    runtimeBootstrap: path.join(
      state,
      "browser-ipc",
      BROWSER_HOST_RUNTIME_BOOTSTRAP_FILENAME,
    ),
  }
}
