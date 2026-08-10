import { spawn } from "node:child_process"

const corepack = process.platform === "win32" ? "corepack.cmd" : "corepack"
const child = spawn(
  corepack,
  [
    "pnpm@10.28.0",
    "exec",
    "playwright",
    "test",
    "e2e/deliver-workbench.pw.ts",
    "--workers=1",
  ],
  {
    cwd: process.cwd(),
    stdio: "inherit",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      VITE_CINEMA_DELIVER_DEV: "1",
      CINEMA_E2E_AGENT_PORT: process.env.CINEMA_E2E_AGENT_PORT || "4297",
    },
  },
)

child.on("error", (error) => {
  console.error(`[cinema-deliver-e2e] ${error.message}`)
  process.exitCode = 1
})

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`[cinema-deliver-e2e] Playwright stopped by ${signal}`)
    process.exitCode = 1
    return
  }
  process.exitCode = code ?? 1
})
