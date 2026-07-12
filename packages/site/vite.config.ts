import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        acceptableUse: "acceptable-use/index.html",
        docs: "docs/index.html",
        main: "index.html",
        pricing: "pricing/index.html",
        privacy: "privacy/index.html",
        refunds: "refunds/index.html",
        terms: "terms/index.html",
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 4173,
  },
})
