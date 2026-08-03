import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const styles = readFileSync(resolve(process.cwd(), "src/renderer/src/styles/workbench.css"), "utf8")

function readRule(pattern: RegExp) {
  return styles.match(pattern)?.[0] ?? ""
}

describe("skill library semantic styles", () => {
  it("uses list-detail tokens for default, hover, and current rows", () => {
    const defaultRule = readRule(/\.skill-library-result-row\s*\{[^}]*\}/s)
    const hoverRule = readRule(
      /\.skill-library-result-row:not\(:disabled\):hover,\s*\.skill-library-result-row:focus-visible\s*\{[^}]*\}/s,
    )
    const currentRule = readRule(/\.skill-library-result-row\.is-selected\s*\{[^}]*\}/s)
    const secondaryRule = readRule(
      /\.skill-library-result-summary,\s*\.skill-library-result-meta\s*\{[^}]*\}/s,
    )

    expect(defaultRule).toContain("background: var(--semantic-list-detail-row-surface);")
    expect(defaultRule).toContain("color: var(--semantic-list-detail-row-primary-text);")
    expect(hoverRule).toContain("background: var(--semantic-list-detail-row-surface-hover);")
    expect(hoverRule).toContain("color: var(--semantic-list-detail-row-primary-text);")
    expect(currentRule).toContain("background: var(--semantic-list-detail-row-surface-current);")
    expect(currentRule).toContain("color: var(--semantic-list-detail-row-current-text);")
    expect(secondaryRule).toContain("color: var(--semantic-list-detail-row-secondary-text);")

    for (const rule of [defaultRule, hoverRule, currentRule, secondaryRule]) {
      expect(rule).not.toMatch(/var\(--(?:brand|seg|surface|text)-/)
    }
  })

  it("keeps image logos unpainted and themes only local or fallback glyphs", () => {
    const iconRule = readRule(/\.skill-library-product-icon\s*\{[^}]*\}/s)
    const placeholderRule = readRule(
      /\.skill-library-product-icon\.is-fallback,\s*\.skill-library-product-icon\.is-local\s*\{[^}]*\}/s,
    )

    expect(iconRule).toContain("border: 1px solid transparent;")
    expect(iconRule).toContain("background: transparent;")
    expect(iconRule).not.toContain("--semantic-detail-icon-")

    expect(placeholderRule).toContain("border-color: var(--semantic-detail-icon-border);")
    expect(placeholderRule).toContain("background: var(--semantic-detail-icon-surface);")
    expect(placeholderRule).toContain("color: var(--semantic-detail-icon-text);")
    expect(placeholderRule).not.toMatch(/var\(--(?:brand|seg|surface|text)-/)
    expect(styles).not.toMatch(/\.skill-library-product-icon\.is-local\s*\{[^}]*var\(--brand-/s)
  })
})
