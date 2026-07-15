import React from "react"
import { createRoot } from "react-dom/client"
import { LanguageProvider } from "../language"
import { DocsApp } from "./DocsApp"
import "../site.css"

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LanguageProvider>
      <DocsApp />
    </LanguageProvider>
  </React.StrictMode>,
)
