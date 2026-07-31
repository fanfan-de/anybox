import { readFileSync, readdirSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import {
  CODE_FONT_FAMILY_STACKS,
  resolveCodeFontFamilyStack,
} from "./code-font"

const stylesRoot = resolve(process.cwd(), "src/renderer/src/styles")

describe("code font runtime", () => {
  it("defines every preset with bundled IBM Plex Mono fallbacks where needed", () => {
    expect(Object.keys(CODE_FONT_FAMILY_STACKS)).toEqual([
      "default",
      "system",
      "jetbrains-mono",
      "cascadia-code",
      "consolas",
    ])
    expect(resolveCodeFontFamilyStack("default")).toContain("\"IBM Plex Mono\"")
    expect(resolveCodeFontFamilyStack("system")).toMatch(/^ui-monospace,/)
    expect(resolveCodeFontFamilyStack("jetbrains-mono")).toMatch(
      /^"JetBrains Mono", "IBM Plex Mono",/,
    )
    expect(resolveCodeFontFamilyStack("cascadia-code")).toMatch(
      /^"Cascadia Code", "IBM Plex Mono",/,
    )
    expect(resolveCodeFontFamilyStack("consolas")).toMatch(
      /^Consolas, "IBM Plex Mono",/,
    )
  })

  it("routes app-owned monospace typography through --font-mono", () => {
    const styleFiles = readdirSync(stylesRoot)
      .filter((fileName) => fileName.endsWith(".css") && fileName !== "fonts.css")
    const forbiddenHardcodedStack =
      /(?:font-family|font)\s*:[^;]*(?:"IBM Plex Mono"|"JetBrains Mono"|"Cascadia (?:Code|Mono)"|Consolas|SFMono-Regular|ui-monospace|monospace)/g

    for (const fileName of styleFiles) {
      const css = readFileSync(resolve(stylesRoot, fileName), "utf8")
      expect(css.match(forbiddenHardcodedStack), fileName).toBeNull()
    }

    for (const fileName of [
      "composer.css",
      "debug.css",
      "right-sidebar.css",
      "settings.css",
      "thread.css",
      "tools.css",
      "workbench.css",
    ]) {
      const css = readFileSync(resolve(stylesRoot, fileName), "utf8")
      expect(css, fileName).toContain("var(--font-mono)")
    }
  })
})
