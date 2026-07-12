import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        docs: "docs/index.html",
        main: "index.html",
        pricing: "pricing/index.html",
        privacy: "privacy/index.html",
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 4173,
  },
})
