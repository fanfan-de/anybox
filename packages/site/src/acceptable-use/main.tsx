import React from "react"
import { createRoot } from "react-dom/client"
import { AcceptableUsePage } from "./AcceptableUsePage"
import "../styles.css"

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AcceptableUsePage />
  </React.StrictMode>,
)
