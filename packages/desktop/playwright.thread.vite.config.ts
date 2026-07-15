import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { resolve } from "node:path"

const rendererAliases = [
  { find: "@anybox/shared", replacement: resolve(__dirname, "../shared/src/index.ts") },
  { find: "@anybox/platform", replacement: resolve(__dirname, "../platform/src/index.ts") },
  { find: "zod", replacement: resolve(__dirname, "../anyboxagent/node_modules/zod") },
  { find: /^react$/, replacement: resolve(__dirname, "node_modules/react") },
  { find: /^react-dom$/, replacement: resolve(__dirname, "node_modules/react-dom") },
]

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: rendererAliases,
    dedupe: ["react", "react-dom"],
  },
  server: {
    host: "127.0.0.1",
    port: 4179,
    strictPort: true,
    fs: {
      allow: [resolve(__dirname, "../..")],
    },
  },
})
