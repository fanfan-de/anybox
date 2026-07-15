import React from "react"
import { createRoot } from "react-dom/client"
import { LanguageProvider } from "../language"
import { TermsPage } from "./TermsPage"
import "../site.css"

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LanguageProvider>
      <TermsPage />
    </LanguageProvider>
  </React.StrictMode>,
)
