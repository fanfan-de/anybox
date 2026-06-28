import react from "@vitejs/plugin-react"
import { defineConfig, externalizeDepsPlugin } from "electron-vite"
import { resolve } from "node:path"

const workspaceAliases = {
  "@anybox/shared": resolve(__dirname, "../shared/src/index.ts"),
  "@anybox/platform": resolve(__dirname, "../platform/src/index.ts"),
  zod: resolve(__dirname, "../anyboxagent/node_modules/zod"),
}

const rendererAliases = [
  ...Object.entries(workspaceAliases).map(([find, replacement]) => ({ find, replacement })),
  { find: /^dockview-react$/, replacement: resolve(__dirname, "../dockview-react/src/index.ts") },
  { find: /^dockview$/, replacement: resolve(__dirname, "../dockview/src/index.ts") },
  { find: /^dockview-core$/, replacement: resolve(__dirname, "../dockview-core/src/index.ts") },
  { find: /^dockview-modules$/, replacement: resolve(__dirname, "../dockview-modules/src/index.ts") },
  { find: /^react$/, replacement: resolve(__dirname, "node_modules/react") },
  { find: /^react-dom$/, replacement: resolve(__dirname, "node_modules/react-dom") },
]

const externalizeRuntimeDeps = externalizeDepsPlugin({
  exclude: ["@anybox/shared", "@anybox/platform"],
})

export default defineConfig({
  main: {
    plugins: [externalizeRuntimeDeps],
    resolve: {
      alias: workspaceAliases,
    },
  },
  preload: {
    plugins: [externalizeRuntimeDeps],
    resolve: {
      alias: workspaceAliases,
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, "src/preload/index.ts"),
          "preview-webview": resolve(__dirname, "src/preload/preview-webview.ts"),
        },
      },
    },
  },
  renderer: {
    plugins: [react()],
    resolve: {
      alias: rendererAliases,
      dedupe: ["react", "react-dom"],
    },
    server: {
      fs: {
        allow: [resolve(__dirname, "../..")],
      },
    },
  },
})
