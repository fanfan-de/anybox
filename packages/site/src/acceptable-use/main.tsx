import React from "react"
import { createRoot } from "react-dom/client"
import { LanguageProvider } from "../language"
import { AcceptableUsePage } from "./AcceptableUsePage"
import "../styles.css"

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LanguageProvider>
      <AcceptableUsePage />
    </LanguageProvider>
  </React.StrictMode>,
)
