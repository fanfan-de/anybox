import { defineConfig } from "vitest/config"
import { resolve } from "node:path"

const workspaceAliases = {
  "@anybox/shared": resolve(__dirname, "../shared/src/index.ts"),
  "@anybox/platform": resolve(__dirname, "../platform/src/index.ts"),
  zod: resolve(__dirname, "../anyboxagent/node_modules/zod"),
}

const testAliases = [
  ...Object.entries(workspaceAliases).map(([find, replacement]) => ({ find, replacement })),
  { find: /^dockview-react$/, replacement: resolve(__dirname, "../dockview-react/src/index.ts") },
  { find: /^dockview$/, replacement: resolve(__dirname, "../dockview/src/index.ts") },
  { find: /^dockview-core$/, replacement: resolve(__dirname, "../dockview-core/src/index.ts") },
  { find: /^dockview-modules$/, replacement: resolve(__dirname, "../dockview-modules/src/index.ts") },
  { find: /^react$/, replacement: resolve(__dirname, "node_modules/react") },
  { find: /^react-dom$/, replacement: resolve(__dirname, "node_modules/react-dom") },
]

export default defineConfig({
  resolve: {
    alias: testAliases,
    dedupe: ["react", "react-dom"],
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    setupFiles: ["./src/renderer/src/test-setup.ts"],
    testTimeout: 20_000,
  },
})
