import { defineConfig } from "vite"

export default defineConfig({
  base: "./",
  build: {
    emptyOutDir: true,
    outDir: "web",
    sourcemap: false,
  },
})
