import { describe, expect, it } from "vitest"
import {
  docsSectionsByLanguage,
  getDocsArticle,
  getDocsArticles,
} from "./docsContent"

describe("docs content", () => {
  it("keeps Chinese and English article routes aligned", () => {
    expect(getDocsArticles("zh").map((article) => article.slug)).toEqual(
      getDocsArticles("en").map((article) => article.slug),
    )
  })

  it("registers the tool system in the configuration section", () => {
    for (const language of ["zh", "en"] as const) {
      const toolsArticle = getDocsArticle("tools", language)
      const configureSection = docsSectionsByLanguage[language][1]

      expect(toolsArticle).toBeDefined()
      expect(configureSection.items).toContain(toolsArticle)
      expect(toolsArticle?.content).toContain("tool_search")
      expect(toolsArticle?.content).toContain("JavaScript Exec")
      expect(toolsArticle?.content).toContain("QuickJS")
      expect(toolsArticle?.content).toContain("tools.read_file")
    }
  })

  it("registers a complete plugin development guide in both languages", () => {
    for (const language of ["zh", "en"] as const) {
      const pluginArticle = getDocsArticle("plugin-development", language)
      const extendSection = docsSectionsByLanguage[language].find((section) =>
        section.items.includes(pluginArticle!),
      )

      expect(pluginArticle).toBeDefined()
      expect(extendSection?.title).toBe(language === "zh" ? "扩展" : "Extend")
      expect(pluginArticle?.content).toContain("plugin.json")
      expect(pluginArticle?.content).toContain("SKILL.md")
      expect(pluginArticle?.content).toContain("${PLUGIN_ROOT}")
      expect(pluginArticle?.content).toContain("ANYBOX_PLUGIN_LOCAL_DIR")
      expect(pluginArticle?.content).toContain("plugin-connector:")
      expect(pluginArticle?.content).toContain(language === "zh" ? "导入 URL" : "Import URL")
    }
  })
})
