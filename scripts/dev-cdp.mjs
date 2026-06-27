import { spawn } from "node:child_process"

const child = spawn("corepack", ["pnpm", "--filter", "anybox-desktop-agent", "dev"], {
  env: {
    ...process.env,
    ANYBOX_REMOTE_DEBUGGING_PORT: process.env.ANYBOX_REMOTE_DEBUGGING_PORT ?? "9222",
  },
  shell: process.platform === "win32",
  stdio: "inherit",
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
