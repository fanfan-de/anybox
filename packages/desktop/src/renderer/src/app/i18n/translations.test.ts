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
    expect(translateLiteral("zh-CN", "Commit message (leave blank to auto-generate)")).toBe("提交信息（留空将自动生成）")
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
    expect(t("zh-CN", "workbench.sessionBag.redaction.enabled", { pattern: "apiKey", max: 20000 })).toBe(
      "\u5339\u914d apiKey \u7684\u952e\uff0c\u6700\u957f 20000 \u4e2a\u5b57\u7b26",
    )
    expect(t("en-US", "workbench.sessionBag.redaction.enabled", { pattern: "apiKey", max: 20000 })).toBe(
      "apiKey keys, max 20000 chars",
    )
    expect(t("zh-CN", "workbench.sessionBag.problem.count", { count: 12, max: 2000 })).toBe(
      "12 / 2000 \u5b57\u7b26",
    )
    expect(t("en-US", "workbench.sessionBag.problem.count", { count: 12, max: 2000 })).toBe(
      "12 / 2000 chars",
    )
    expect(t("zh-CN", "composer.context.buttonLabel", { percent: 25, input: "25k", window: "100k" })).toBe(
      "上下文压力 25%（25k / 100k 输入 tokens）",
    )
    expect(t("en-US", "composer.context.cacheValue", { read: "2,000", write: 100 })).toBe(
      "2,000 read / 100 write",
    )
    expect(t("zh-CN", "composer.compact.status.noop.title")).toBe("无需压缩")
    expect(t("en-US", "composer.compact.status.noop.detail")).toBe(
      "Recent turns are already kept raw; there is not enough older history yet.",
    )
    expect(t("zh-CN", "composer.compact.status.failed.detail", { message: "session busy" })).toBe("session busy")
    expect(translateLiteral("zh-CN", "DeepSeek V4 Pro does not support image or PDF input.")).toBe(
      "DeepSeek V4 Pro 不支持图片或 PDF 输入。",
    )
  })

  it("exposes update center translations", () => {
    expect(t("zh-CN", "updates.dialog.title.downloading")).toBe("正在下载更新")
    expect(t("zh-CN", "updates.summary.downloadingVersion", { version: "0.1.18" })).toBe(
      "正在下载 Anybox 0.1.18。",
    )
    expect(t("en-US", "updates.action.downloadInBackground")).toBe("Download in background")
  })

  it("exposes dictionaries by locale", () => {
    expect(getTranslationDictionary("zh-CN")["settings.appearance.languageTitle"]).toBe("显示语言")
    expect(getTranslationDictionary("en-US")["settings.appearance.languageTitle"]).toBe("Display Language")
  })

  it("exposes thread trace translations", () => {
    expect(getTranslationDictionary("zh-CN")["thread.toolTrace.inputLabel"]).toBe("\u8f93\u5165")
    expect(getTranslationDictionary("en-US")["thread.toolTrace.inputLabel"]).toBe("Input")
    expect(getTranslationDictionary("zh-CN")["thread.permission.trace.requested"]).toBe("请求权限")
    expect(translateLiteral("zh-CN", "Run MCP tool resolve-library-id from Context7 Docs.")).toBe(
      "运行 Context7 Docs 的 MCP 工具 resolve-library-id。",
    )
    expect(translateLiteral(
      "zh-CN",
      "Tool requires approval before it can continue. Original approval rationale: MCP tool 'resolve-library-id' from 'Context7 Docs' requires approval by configuration.",
    )).toBe(
      "工具需要批准后才能继续。原始原因：Context7 Docs 的 MCP 工具 resolve-library-id 按配置需要批准。",
    )
  })
})
