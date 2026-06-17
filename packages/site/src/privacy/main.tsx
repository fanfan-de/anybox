import React from "react"
import { createRoot } from "react-dom/client"
import { PrivacyPage } from "./PrivacyPage"
import "../styles.css"

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PrivacyPage />
  </React.StrictMode>,
)
