import { getProcessEnvValue } from "#env/compat.ts"

function truthy(key: string) {
  const value = getProcessEnvValue(key)?.toLowerCase()
  return value === "true" || value === "1"
}

function env(key: string) {
  return getProcessEnvValue(key)
}

export namespace Flag {
  export const ANYBOX_AUTO_SHARE = truthy("ANYBOX_AUTO_SHARE")
  export const ANYBOX_GIT_BASH_PATH = env("ANYBOX_GIT_BASH_PATH")
  export const ANYBOX_CONFIG = env("ANYBOX_CONFIG")
  export declare const ANYBOX_CONFIG_DIR: string | undefined
  export const ANYBOX_CONFIG_CONTENT = env("ANYBOX_CONFIG_CONTENT")
  export const ANYBOX_DISABLE_AUTOUPDATE = truthy("ANYBOX_DISABLE_AUTOUPDATE")
  export const ANYBOX_DISABLE_PRUNE = truthy("ANYBOX_DISABLE_PRUNE")
  export const ANYBOX_DISABLE_TERMINAL_TITLE = truthy("ANYBOX_DISABLE_TERMINAL_TITLE")
  export const ANYBOX_PERMISSION = env("ANYBOX_PERMISSION")
  export const ANYBOX_DISABLE_DEFAULT_PLUGINS = truthy("ANYBOX_DISABLE_DEFAULT_PLUGINS")
  export const ANYBOX_DISABLE_LSP_DOWNLOAD = truthy("ANYBOX_DISABLE_LSP_DOWNLOAD")
  export const ANYBOX_ENABLE_EXPERIMENTAL_MODELS = truthy("ANYBOX_ENABLE_EXPERIMENTAL_MODELS")
  export const ANYBOX_DISABLE_AUTOCOMPACT = truthy("ANYBOX_DISABLE_AUTOCOMPACT")
  export const ANYBOX_DISABLE_MODELS_FETCH = truthy("ANYBOX_DISABLE_MODELS_FETCH")
  export const ANYBOX_DISABLE_TOOL_SEARCH = truthy("ANYBOX_DISABLE_TOOL_SEARCH")
  export const ANYBOX_DISABLE_CLAUDE_CODE = truthy("ANYBOX_DISABLE_CLAUDE_CODE")
  export const ANYBOX_DISABLE_CLAUDE_CODE_PROMPT =
    ANYBOX_DISABLE_CLAUDE_CODE || truthy("ANYBOX_DISABLE_CLAUDE_CODE_PROMPT")
  export const ANYBOX_DISABLE_CLAUDE_CODE_SKILLS =
    ANYBOX_DISABLE_CLAUDE_CODE || truthy("ANYBOX_DISABLE_CLAUDE_CODE_SKILLS")
  export declare const ANYBOX_DISABLE_PROJECT_CONFIG: boolean
  export const ANYBOX_FAKE_VCS = env("ANYBOX_FAKE_VCS")
  export const ANYBOX_CLIENT = env("ANYBOX_CLIENT") ?? "cli"
  export const ANYBOX_SERVER_PASSWORD = env("ANYBOX_SERVER_PASSWORD")
  export const ANYBOX_SERVER_USERNAME = env("ANYBOX_SERVER_USERNAME")

  // Experimental
  export const ANYBOX_EXPERIMENTAL = truthy("ANYBOX_EXPERIMENTAL")
  export const ANYBOX_EXPERIMENTAL_FILEWATCHER = truthy("ANYBOX_EXPERIMENTAL_FILEWATCHER")
  export const ANYBOX_EXPERIMENTAL_DISABLE_FILEWATCHER = truthy("ANYBOX_EXPERIMENTAL_DISABLE_FILEWATCHER")
  export const ANYBOX_EXPERIMENTAL_ICON_DISCOVERY =
    ANYBOX_EXPERIMENTAL || truthy("ANYBOX_EXPERIMENTAL_ICON_DISCOVERY")
  export const ANYBOX_EXPERIMENTAL_DISABLE_COPY_ON_SELECT = truthy("ANYBOX_EXPERIMENTAL_DISABLE_COPY_ON_SELECT")
  export const ANYBOX_ENABLE_EXA =
    truthy("ANYBOX_ENABLE_EXA") || ANYBOX_EXPERIMENTAL || truthy("ANYBOX_EXPERIMENTAL_EXA")
  export const ANYBOX_EXPERIMENTAL_BASH_MAX_OUTPUT_LENGTH = number("ANYBOX_EXPERIMENTAL_BASH_MAX_OUTPUT_LENGTH")
  export const ANYBOX_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS = number("ANYBOX_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS")
  export const ANYBOX_EXPERIMENTAL_AGENT_LOOP_LIMIT = number("ANYBOX_EXPERIMENTAL_AGENT_LOOP_LIMIT")
  export const ANYBOX_EXPERIMENTAL_LLM_TOTAL_TIMEOUT_MS = number("ANYBOX_EXPERIMENTAL_LLM_TOTAL_TIMEOUT_MS")
  export const ANYBOX_EXPERIMENTAL_LLM_STEP_TIMEOUT_MS = number("ANYBOX_EXPERIMENTAL_LLM_STEP_TIMEOUT_MS")
  export const ANYBOX_EXPERIMENTAL_OUTPUT_TOKEN_MAX = number("ANYBOX_EXPERIMENTAL_OUTPUT_TOKEN_MAX")
  export const ANYBOX_EXPERIMENTAL_OXFMT = ANYBOX_EXPERIMENTAL || truthy("ANYBOX_EXPERIMENTAL_OXFMT")
  export const ANYBOX_EXPERIMENTAL_LSP_TY = truthy("ANYBOX_EXPERIMENTAL_LSP_TY")
  export const ANYBOX_EXPERIMENTAL_LSP_TOOL = ANYBOX_EXPERIMENTAL || truthy("ANYBOX_EXPERIMENTAL_LSP_TOOL")
  export const ANYBOX_DEBUG_STREAM_STDOUT = truthy("ANYBOX_DEBUG_STREAM_STDOUT")
  export const ANYBOX_DEBUG_FULLSTREAM_PROBE = truthy("ANYBOX_DEBUG_FULLSTREAM_PROBE")
  export const ANYBOX_DISABLE_FILETIME_CHECK = truthy("ANYBOX_DISABLE_FILETIME_CHECK")
  export const ANYBOX_EXPERIMENTAL_PLAN_MODE = ANYBOX_EXPERIMENTAL || truthy("ANYBOX_EXPERIMENTAL_PLAN_MODE")
  export const ANYBOX_MODELS_URL = env("ANYBOX_MODELS_URL")

  function number(key: string) {
    const value = env(key)
    if (!value) return undefined
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
  }
}

// Dynamic getter for ANYBOX_DISABLE_PROJECT_CONFIG
// This must be evaluated at access time, not module load time,
// because external tooling may set this env var at runtime
Object.defineProperty(Flag, "ANYBOX_DISABLE_PROJECT_CONFIG", {
  get() {
    return truthy("ANYBOX_DISABLE_PROJECT_CONFIG")
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for ANYBOX_CONFIG_DIR
// This must be evaluated at access time, not module load time,
// because external tooling may set this env var at runtime
Object.defineProperty(Flag, "ANYBOX_CONFIG_DIR", {
  get() {
    return env("ANYBOX_CONFIG_DIR")
  },
  enumerable: true,
  configurable: false,
})
