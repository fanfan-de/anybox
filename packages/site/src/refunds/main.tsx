import React from "react"
import { createRoot } from "react-dom/client"
import { LanguageProvider } from "../language"
import { RefundsPage } from "./RefundsPage"
import "../site.css"

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LanguageProvider>
      <RefundsPage />
    </LanguageProvider>
  </React.StrictMode>,
)
