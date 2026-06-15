import { describe, expect, it } from "vitest"
import { normalizeCodeThemePreference, resolveCodeHighlightTheme } from "./code-theme"

describe("code theme preferences", () => {
  it("resolves auto to GitHub themes for the current color mode", () => {
    expect(resolveCodeHighlightTheme("auto", "light")).toBe("github-light")
    expect(resolveCodeHighlightTheme("auto", "dark")).toBe("github-dark")
  })

  it("keeps supported explicit themes and normalizes invalid values", () => {
    expect(normalizeCodeThemePreference("dracula")).toBe("dracula")
    expect(normalizeCodeThemePreference("unknown-theme")).toBe("auto")
    expect(normalizeCodeThemePreference(null)).toBe("auto")
  })
})
