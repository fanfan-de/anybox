import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const databaseRoot = await mkdtemp(join(tmpdir(), "anybox-server-test-db-"))
const promptRoot = await mkdtemp(join(tmpdir(), "anybox-server-test-prompts-"))
const agentDataRoot = await mkdtemp(join(tmpdir(), "anybox-server-test-data-"))
const databaseFile = join(databaseRoot, "agent-local-test.db")

try {
  const testFiles = [
    "Test/server.lifecycle.test.ts",
    "Test/server.api.test.ts",
    "Test/plugin.test.ts",
  ]

  for (const testFile of testFiles) {
    const child = Bun.spawn([process.execPath, "test", "--max-concurrency=1", testFile], {
      cwd: join(import.meta.dir, ".."),
      env: {
        ...process.env,
        ANYBOX_AGENT_DATA_DIR: agentDataRoot,
        ANYBOX_DATABASE_FILE: databaseFile,
        ANYBOX_PROMPTS_ROOT: promptRoot,
      },
      stderr: "inherit",
      stdout: "inherit",
    })

    const exitCode = await child.exited
    if (exitCode !== 0) {
      process.exitCode = exitCode
      break
    }
  }
} finally {
  await rm(databaseRoot, { recursive: true, force: true })
  await rm(promptRoot, { recursive: true, force: true })
  await rm(agentDataRoot, { recursive: true, force: true })
}
