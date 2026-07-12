import React from "react"
import { createRoot } from "react-dom/client"
import { TermsPage } from "./TermsPage"
import "../styles.css"

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <TermsPage />
  </React.StrictMode>,
)
