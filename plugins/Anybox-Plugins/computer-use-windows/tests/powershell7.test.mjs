import assert from "node:assert/strict"
import test from "node:test"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const {
  createPowerShell7Detector,
  POWERSHELL_7_INSTALL_MESSAGE,
} = require("../scripts/lib/powershell7")

function probeResult(version = "7.6.4", edition = "Core") {
  return {
    status: 0,
    stdout: JSON.stringify({ version, edition }),
    stderr: "",
  }
}

test("computer-use PowerShell detector uses pwsh from PATH and caches its exact version", () => {
  const commands = []
  let probes = 0
  const detector = createPowerShell7Detector({
    platform: "win32",
    env: {},
    whichCommand(command) {
      commands.push(command)
      return command === "pwsh.exe" ? "C:\\Tools\\pwsh.exe" : null
    },
    spawnSync(executable, args, options) {
      probes += 1
      assert.equal(executable, "C:\\Tools\\pwsh.exe")
      assert.equal(options.timeout, 5_000)
      assert.deepEqual(args.slice(0, 4), ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command"])
      return probeResult()
    },
  })

  const first = detector.detect()
  const second = detector.detect()
  assert.deepEqual(first, {
    available: true,
    executable: "C:\\Tools\\pwsh.exe",
    version: "7.6.4",
    edition: "Core",
    major: 7,
  })
  assert.strictEqual(second, first)
  assert.deepEqual(commands, ["pwsh.exe"])
  assert.equal(probes, 1)
})

test("computer-use PowerShell detector rejects non-7/Core runtimes", () => {
  for (const [version, edition] of [["6.2.7", "Core"], ["8.0.0", "Core"], ["7.6.4", "Desktop"]]) {
    const detector = createPowerShell7Detector({
      whichCommand: () => "C:\\Tools\\pwsh.exe",
      spawnSync: () => probeResult(version, edition),
    })
    const result = detector.detect()
    assert.equal(result.available, false)
    assert.equal(result.message, POWERSHELL_7_INSTALL_MESSAGE)
  }
})

test("computer-use PowerShell detector never searches for powershell.exe", () => {
  const commands = []
  const detector = createPowerShell7Detector({
    platform: "win32",
    env: {},
    whichCommand(command) {
      commands.push(command)
      return null
    },
    isFile: () => false,
    spawnSync() {
      throw new Error("probe should not run")
    },
  })

  const result = detector.detect()
  assert.equal(result.available, false)
  assert.equal(result.message, POWERSHELL_7_INSTALL_MESSAGE)
  assert.deepEqual(commands, ["pwsh.exe", "pwsh"])
})
