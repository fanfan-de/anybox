import React from "react"
import { createRoot } from "react-dom/client"
import { LanguageProvider } from "../language"
import { PricingPage } from "./PricingPage"
import "../site.css"

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LanguageProvider>
      <PricingPage />
    </LanguageProvider>
  </React.StrictMode>,
)
