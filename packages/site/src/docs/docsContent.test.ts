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
      const configureSection = docsSectionsByLanguage[language].find((section) =>
        section.items.includes(toolsArticle!),
      )

      expect(toolsArticle).toBeDefined()
      expect(configureSection?.items).toContain(toolsArticle)
      expect(toolsArticle?.content).toContain("tool_search")
      expect(toolsArticle?.content).toContain("anybox_tool_search")
      expect(toolsArticle?.content).toContain("JavaScript Exec")
      expect(toolsArticle?.content).toContain("QuickJS")
      expect(toolsArticle?.content).toContain("tools.read_file")
    }
  })

  it("publishes a complete user journey in both languages", () => {
    const expectedSlugs = [
      "overview",
      "use-cases",
      "getting-started",
      "projects-and-sessions",
      "permissions",
      "core-concept",
      "providers",
      "tools",
      "skills",
      "chrome",
      "computer-use-windows",
      "build-web-apps",
      "plugin-development",
      "troubleshooting",
      "faq",
    ]

    for (const language of ["zh", "en"] as const) {
      const articles = getDocsArticles(language)

      expect(articles.map((article) => article.slug)).toEqual(expectedSlugs)
      expect(articles.every((article) => article.content.length > 500)).toBe(true)
      expect(articles.every((article) => article.description.length > 20)).toBe(true)
    }

    expect(getDocsArticle("overview", "zh")?.content).toContain(
      "Anybox 是一款开源的 AI Agent 桌面工作台",
    )
    expect(getDocsArticle("overview", "en")?.content).toContain(
      "Anybox is an open-source desktop AI agent workspace",
    )
  })

  it("registers the featured plugin guides in both languages", () => {
    for (const language of ["zh", "en"] as const) {
      const chromeArticle = getDocsArticle("chrome", language)
      const computerUseArticle = getDocsArticle("computer-use-windows", language)
      const buildWebAppsArticle = getDocsArticle("build-web-apps", language)
      const pluginGuideSection = docsSectionsByLanguage[language].find((section) =>
        section.items.includes(chromeArticle!),
      )

      expect(pluginGuideSection?.title).toBe(
        language === "zh" ? "插件指南" : "Plugin Guides",
      )
      expect(pluginGuideSection?.items).toContain(computerUseArticle)
      expect(pluginGuideSection?.items).toContain(buildWebAppsArticle)
      expect(chromeArticle?.content).toContain("Anybox Chrome")
      expect(chromeArticle?.content).toContain("Computer Use")
      expect(computerUseArticle?.content).toContain("Windows 11 x64")
      expect(computerUseArticle?.content).toContain("Esc")
      expect(computerUseArticle?.content).toContain("Chrome")
      expect(buildWebAppsArticle?.content).toContain("frontend-app-builder")
      expect(buildWebAppsArticle?.content).toContain("frontend-testing-debugging")
      expect(buildWebAppsArticle?.content).toContain("Stripe")
      expect(buildWebAppsArticle?.content).toContain("Supabase")
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
