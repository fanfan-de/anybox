import { AsyncLocalStorage } from "node:async_hooks"
import path from "node:path"

type InstanceContext = { directory: string }
const storage = new AsyncLocalStorage<InstanceContext>()

export const Instance = {
  async provide<R>(input: { directory: string; init?: () => Promise<unknown>; fn: () => R }): Promise<Awaited<R>> {
    const directory = path.resolve(input.directory)
    await input.init?.()
    return await storage.run({ directory }, input.fn)
  },
  get directory() {
    return storage.getStore()?.directory ?? process.cwd()
  },
  get worktree() {
    return this.directory
  },
  containsPath(filepath: string) {
    const relative = path.relative(this.directory, path.resolve(filepath))
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
  },
  async disposeAll() {},
}
