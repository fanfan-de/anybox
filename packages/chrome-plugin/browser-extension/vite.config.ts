import { resolve } from "node:path"
import { defineConfig } from "vite"

export default defineConfig({
  resolve: {
    alias: {
      "@anybox/chrome-shared/browser-contract": resolve(__dirname, "../shared/src/browser-contract.ts"),
      "@anybox/chrome-shared/browser-extension": resolve(__dirname, "../shared/src/browser-extension.ts"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: process.env.ANYBOX_BROWSER_EXTENSION_SOURCEMAP !== "false",
    rollupOptions: {
      input: {
        background: resolve(__dirname, "src/background/index.ts"),
        content: resolve(__dirname, "src/content/overlay.ts"),
        popup: resolve(__dirname, "popup.html"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
})
