import React from "react"
import { createRoot } from "react-dom/client"
import { PricingPage } from "./PricingPage"
import "../styles.css"

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PricingPage />
  </React.StrictMode>,
)
