import React from "react"
import { createRoot } from "react-dom/client"
import { RefundsPage } from "./RefundsPage"
import "../styles.css"

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RefundsPage />
  </React.StrictMode>,
)
