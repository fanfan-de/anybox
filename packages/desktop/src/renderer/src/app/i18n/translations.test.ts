import { describe, expect, it } from "vitest"
import { enUS, getTranslationDictionary, t, translateLiteral, zhCN } from "./translations"

describe("i18n translations", () => {
  it("keeps English and Chinese dictionaries aligned", () => {
    expect(Object.keys(enUS).sort()).toEqual(Object.keys(zhCN).sort())
  })

  it("translates known literals in both directions", () => {
    expect(translateLiteral("zh-CN", "Open settings")).toBe("打开设置")
    expect(translateLiteral("en-US", "关闭设置")).toBe("Close settings")
  })

  it("formats common count literals", () => {
    expect(translateLiteral("zh-CN", "3 of 10 enabled")).toBe("已启用 3 / 10")
    expect(translateLiteral("en-US", "3 of 10 enabled")).toBe("3 of 10 enabled")
  })

  it("translates Git quick menu literals", () => {
    expect(translateLiteral("zh-CN", "Commit or push")).toBe("提交或推送")
    expect(translateLiteral("zh-CN", "Create pull request")).toBe("创建 Pull Request")
    expect(translateLiteral("zh-CN", "Current branch: master")).toBe("当前分支：master")
    expect(translateLiteral("zh-CN", "Create and checkout new branch...")).toBe("创建并检出新分支...")
    expect(translateLiteral("zh-CN", "Switched to master.")).toBe("已切换到 master。")
  })

  it("keeps glossary terms while translating surrounding UI", () => {
    expect(translateLiteral("zh-CN", "API key")).toBe("API key")
    expect(translateLiteral("zh-CN", "Git branches")).toBe("Git 分支")
    expect(getTranslationDictionary("zh-CN")["mcp.title"]).toBe("MCP 服务器")
    expect(getTranslationDictionary("zh-CN")["connections.mobile.copyToken"]).toBe("复制 token")
  })

  it("formats localized dynamic UI messages", () => {
    expect(t("zh-CN", "connections.mobile.lastSeen", { time: "10:30" })).toBe("上次在线 10:30")
    expect(t("zh-CN", "calendar.scheduleRange", { date: "6月16日 周二" })).toBe("6月16日 周二 + 14 天")
    expect(t("en-US", "files.addCommentOnLine", { line: 42 })).toBe("Add comment on line 42")
  })

  it("exposes dictionaries by locale", () => {
    expect(getTranslationDictionary("zh-CN")["settings.appearance.languageTitle"]).toBe("显示语言")
    expect(getTranslationDictionary("en-US")["settings.appearance.languageTitle"]).toBe("Display Language")
  })

  it("exposes thread trace translations", () => {
    expect(getTranslationDictionary("zh-CN")["thread.processTrace.title"]).toBe("\u5df2\u5904\u7406")
    expect(getTranslationDictionary("en-US")["thread.processTrace.title"]).toBe("Processed")
    expect(getTranslationDictionary("zh-CN")["thread.toolTrace.inputLabel"]).toBe("\u8f93\u5165")
    expect(getTranslationDictionary("en-US")["thread.toolTrace.inputLabel"]).toBe("Input")
  })
})
