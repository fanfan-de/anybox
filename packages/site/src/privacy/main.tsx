import React from "react"
import { createRoot } from "react-dom/client"
import { LanguageProvider } from "../language"
import { PrivacyPage } from "./PrivacyPage"
import "../site.css"

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LanguageProvider>
      <PrivacyPage />
    </LanguageProvider>
  </React.StrictMode>,
)
