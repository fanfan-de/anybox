import "@vscode/codicons/dist/codicon.css"
import "@xterm/xterm/css/xterm.css"
import "../../../../dockview-react/dist/styles/dockview.css"
import React from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App"
import { I18nProvider } from "./app/i18n/I18nProvider"
import { installRendererMemoryDiagnostics } from "./app/renderer-memory-diagnostics"
import { RootErrorBoundary, installRendererGlobalErrorReporting } from "./app/renderer-error-reporting"
import "./styles/index.css"

installRendererGlobalErrorReporting()
installRendererMemoryDiagnostics()

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <I18nProvider>
        <App />
      </I18nProvider>
    </RootErrorBoundary>
  </React.StrictMode>,
)
