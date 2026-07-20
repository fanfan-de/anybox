"use strict"

const { cuError } = require("./errors")
const { normalizeProcessName } = require("./window-registry")

const SAFETY_VALUES = Object.freeze([
  "normal",
  "submit_or_send",
  "delete",
  "upload",
  "install",
  "auth_or_secret",
  "finance",
  "security_settings",
])
const HARD_REJECT_SAFETY = new Set(["auth_or_secret", "finance", "security_settings"])
const ELEVATED_REVIEW_SAFETY = new Set(["submit_or_send", "delete", "upload", "install"])
const BLOCKED_PROCESSES = new Set([
  "1password.exe",
  "anybox.exe",
  "anybox-agent.exe",
  "anybox-desktop-agent.exe",
  "bash.exe",
  "bitwarden.exe",
  "chatgpt.exe",
  "cmd.exe",
  "codex.exe",
  "conhost.exe",
  "consent.exe",
  "computer-use-helper.exe",
  "credentialui.exe",
  "dashlane.exe",
  "keepass.exe",
  "keepassxc.exe",
  "lastpass.exe",
  "lockapp.exe",
  "openconsole.exe",
  "powershell.exe",
  "pwsh.exe",
  "securityhealthsystray.exe",
  "windowsterminal.exe",
  "wsl.exe",
  "wslhost.exe",
  "wt.exe",
])
const BLOCKED_TITLE_PATTERNS = [
  /^Anybox(?:\s+Agent\s+Desktop)?$/i,
  /\bCAPTCHA\b/i,
  /\bCredential\b/i,
  /\bUser Account Control\b/i,
  /\bWindows Security\b/i,
  /\bsecurity warning\b/i,
  /\bdeceptive site ahead\b/i,
  /\bprivacy error\b/i,
  /\byour connection is not private\b/i,
]
const BLOCKED_IDENTITY_PATTERNS = [
  /microsoft\.windows\.sechealthui/i,
  /microsoft\.windows\.terminal/i,
  /microsoft\.windows\.auth/i,
  /\bcredential/i,
  /passwordmanager/i,
]

function classifyWindow(window) {
  const processName = normalizeProcessName(window?.processName)
  if (BLOCKED_PROCESSES.has(processName)) {
    return { blocked: true, reason: `Blocked target process: ${processName}` }
  }
  const title = String(window?.title || "")
  for (const pattern of BLOCKED_TITLE_PATTERNS) {
    if (pattern.test(title)) {
      return { blocked: true, reason: "Blocked target window by security policy." }
    }
  }
  return { blocked: false }
}

function assertWindowAllowed(window) {
  const result = classifyWindow(window)
  if (result.blocked) throw cuError("CU_APP_BLOCKED", result.reason)
  return result
}

function classifyApp(app) {
  const processName = normalizeProcessName(app?.processName)
  if (BLOCKED_PROCESSES.has(processName)) {
    return { blocked: true, reason: `Blocked target process: ${processName}` }
  }
  const identity = `${app?.appId || ""} ${app?.displayName || ""}`
  if (
    BLOCKED_TITLE_PATTERNS.some((pattern) => pattern.test(String(app?.displayName || "")))
    || BLOCKED_IDENTITY_PATTERNS.some((pattern) => pattern.test(identity))
  ) {
    return { blocked: true, reason: "Blocked application identity by security policy." }
  }
  return { blocked: false }
}

function validatePurpose(args) {
  const purpose = String(args?.purpose || "").trim()
  if (!purpose) throw cuError("CU_INVALID_ARGUMENT", "Action tools require a non-empty purpose.")
  return purpose
}

function validateSafety(args) {
  const safety = String(args?.safety || "normal").trim()
  if (!SAFETY_VALUES.includes(safety)) {
    throw cuError("CU_INVALID_ARGUMENT", `Invalid safety value: ${safety}`)
  }
  if (HARD_REJECT_SAFETY.has(safety)) {
    throw cuError("CU_APP_BLOCKED", `Safety category '${safety}' cannot be automated by Computer Use.`)
  }
  return {
    safety,
    elevatedReview: ELEVATED_REVIEW_SAFETY.has(safety),
  }
}

module.exports = {
  BLOCKED_PROCESSES,
  BLOCKED_TITLE_PATTERNS,
  ELEVATED_REVIEW_SAFETY,
  HARD_REJECT_SAFETY,
  SAFETY_VALUES,
  assertWindowAllowed,
  classifyApp,
  classifyWindow,
  validatePurpose,
  validateSafety,
}
