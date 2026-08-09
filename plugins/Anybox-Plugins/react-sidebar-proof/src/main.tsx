import React, { StrictMode, useState } from "react"
import { createRoot } from "react-dom/client"
import "./styles.css"

function App() {
  const [count, setCount] = useState(0)
  const [accent, setAccent] = useState<"violet" | "mint">("violet")

  return (
    <main className={`proof-shell is-${accent}`}>
      <header className="proof-header">
        <span className="proof-eyebrow">Plugin-owned React UI</span>
        <h1>React Sidebar Proof</h1>
        <p>This page, its state, and its styles are bundled inside the plugin.</p>
      </header>

      <section className="proof-card" aria-labelledby="counter-title">
        <div className="proof-card-heading">
          <div>
            <span>Interactive state</span>
            <h2 id="counter-title">Counter</h2>
          </div>
          <output aria-live="polite">{count}</output>
        </div>
        <div className="proof-actions">
          <button type="button" onClick={() => setCount((value) => value - 1)} aria-label="Decrease counter">−</button>
          <button type="button" className="is-primary" onClick={() => setCount((value) => value + 1)}>Increase</button>
          <button type="button" onClick={() => setCount(0)}>Reset</button>
        </div>
      </section>

      <section className="proof-card" aria-labelledby="accent-title">
        <div className="proof-card-heading">
          <div>
            <span>Component state</span>
            <h2 id="accent-title">Accent</h2>
          </div>
          <span className="proof-status"><i /> Live</span>
        </div>
        <div className="proof-segmented" role="group" aria-label="Accent color">
          <button type="button" aria-pressed={accent === "violet"} onClick={() => setAccent("violet")}>Violet</button>
          <button type="button" aria-pressed={accent === "mint"} onClick={() => setAccent("mint")}>Mint</button>
        </div>
      </section>

      <footer>
        <span>React 19</span>
        <span>Local package view</span>
      </footer>
    </main>
  )
}

const root = document.getElementById("root")
if (!root) throw new Error("React root was not found.")
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
