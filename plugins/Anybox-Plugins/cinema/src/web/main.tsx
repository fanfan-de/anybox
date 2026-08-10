import React from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ReactFlowProvider } from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import "./styles.css"
import { App } from "./App"
import { I18nProvider } from "./i18n"

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <ReactFlowProvider>
          <App />
        </ReactFlowProvider>
      </I18nProvider>
    </QueryClientProvider>
  </React.StrictMode>,
)
