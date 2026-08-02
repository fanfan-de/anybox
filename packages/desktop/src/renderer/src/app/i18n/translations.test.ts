import { describe, expect, it } from "vitest"
import { APP_LOCALES } from "../../../../shared/locale"
import { enUS, getTranslationDictionary, t, translateLiteral, zhCN } from "./translations"

describe("i18n translations", () => {
  it("keeps every locale dictionary aligned", () => {
    const expectedKeys = Object.keys(zhCN).sort()
    for (const locale of APP_LOCALES) {
      expect(Object.keys(getTranslationDictionary(locale)).sort()).toEqual(expectedKeys)
    }
    expect(Object.keys(enUS).sort()).toEqual(expectedKeys)
  })

  it("preserves interpolation placeholders in every locale", () => {
    const placeholderNames = (value: string) => [...value.matchAll(/\{[\w.-]+\}/g)].map((match) => match[0]).sort()

    for (const locale of APP_LOCALES.filter((value) => value !== "zh-CN" && value !== "en-US")) {
      const dictionary = getTranslationDictionary(locale)
      const source = locale === "zh-TW" ? zhCN : enUS
      for (const key of Object.keys(source) as Array<keyof typeof source>) {
        const expected = placeholderNames(source[key]).filter((placeholder) =>
          locale === "zh-TW" || placeholder !== "{plural}",
        )
        expect(placeholderNames(dictionary[key]), `${locale}:${key}`).toEqual(expected)
        expect(dictionary[key].trim(), `${locale}:${key}`).not.toBe("")
      }
    }
  })

  it("translates known literals in both directions", () => {
    expect(translateLiteral("zh-CN", "Open settings")).toBe("打开设置")
    expect(translateLiteral("en-US", "关闭设置")).toBe("Close settings")
    expect(translateLiteral("zh-CN", "File Tools")).toBe("文件工具")
    expect(translateLiteral("zh-CN", "Multi-Agent Tools")).toBe("多智能体工具")
    expect(translateLiteral("zh-CN", "Product Interaction Tools")).toBe("产品交互体验工具")
    expect(translateLiteral("zh-CN", "Code Tools")).toBe("代码工具")
    expect(translateLiteral("zh-CN", "Plugin, Skill & MCP Tools")).toBe("插件 skill MCP 类工具")
  })

  it("formats common count literals", () => {
    expect(translateLiteral("zh-CN", "3 of 10 enabled")).toBe("已启用 3 / 10")
    expect(translateLiteral("en-US", "3 of 10 enabled")).toBe("3 of 10 enabled")
    expect(translateLiteral("zh-TW", "3 of 10 enabled")).toBe("已啟用 3 / 10")
    expect(translateLiteral("ja-JP", "3 of 10 enabled")).toBe("10 件中 3 件を有効化")
    expect(translateLiteral("ko-KR", "3 of 10 enabled")).toBe("10개 중 3개 활성화")
    for (const locale of ["pt-BR", "es-419", "de-DE", "fr-FR", "id-ID", "it-IT", "pl-PL", "tr-TR", "vi-VN"] as const) {
      const translated = translateLiteral(locale, "3 of 10 enabled")
      expect(translated, locale).not.toBe("3 of 10 enabled")
      expect(translated, locale).toContain("3")
      expect(translated, locale).toContain("10")
    }
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

  it("exposes localized Tool Module catalog and availability copy", () => {
    expect(t("zh-CN", "tools.modules.catalog.workspace.execution.title")).toBe("工作区执行")
    expect(t("zh-CN", "tools.modules.catalog.runtime.bootstrap.description")).toBe(
      "发现可选能力，并与用户进行交互。",
    )
    expect(t("zh-CN", "tools.modules.tool.tool_search.title")).toBe("工具搜索")
    expect(t("zh-TW", "tools.modules.catalog.workspace.files.title")).toBe("工作區檔案")
    expect(t("en-US", "tools.modules.catalog.agent.delegation.title")).toBe("Agent Delegation")
    expect(t("zh-CN", "tools.modules.availabilityCopy", { enabled: 2, total: 5 })).toBe(
      "已启用 2/5 个工具。这里只修改工具可用性，不会改变模块激活策略。",
    )
  })

  it("exposes localized terminal empty-state controls", () => {
    expect(t("zh-CN", "terminal.emptyState")).toBe("当前没有打开的终端会话。")
    expect(t("zh-TW", "terminal.create")).toBe("建立終端機")
    expect(t("ja-JP", "terminal.shellProfile")).toBe("ターミナルのシェルプロファイル")
    expect(t("en-US", "terminal.resizePanel")).toBe("Resize terminal panel")
  })

  it("exposes dictionaries by locale", () => {
    expect(getTranslationDictionary("zh-CN")["settings.appearance.languageTitle"]).toBe("显示语言")
    expect(getTranslationDictionary("en-US")["settings.appearance.languageTitle"]).toBe("Display Language")
    expect(getTranslationDictionary("zh-CN")["settings.appearance.codeFont"]).toBe("代码字体")
    expect(getTranslationDictionary("en-US")["settings.appearance.codeFont"]).toBe("Code Font")
    expect(getTranslationDictionary("zh-TW")["settings.appearance.languageTitle"]).toBe("顯示語言")
    expect(getTranslationDictionary("ja-JP")["settings.appearance.languageTitle"]).toBe("表示言語")
    expect(getTranslationDictionary("ko-KR")["settings.appearance.languageTitle"]).toBe("표시 언어")
    expect(getTranslationDictionary("zh-CN")["branchChat.name"]).toBe("分支对话")
    expect(getTranslationDictionary("zh-TW")["branchChat.name"]).toBe("分支對話")
    expect(getTranslationDictionary("en-US")["branchChat.name"]).toBe("Branch Chat")
    expect(translateLiteral("zh-CN", "Branch Chat")).toBe("分支对话")
    expect(getTranslationDictionary("zh-CN")["planner.title"]).toBe("计划")
    expect(getTranslationDictionary("en-US")["shell.openPlanner"]).toBe("Open Planner")
  })

  it("exposes thread trace translations", () => {
    expect(getTranslationDictionary("zh-CN")["thread.toolTrace.inputLabel"]).toBe("\u8f93\u5165")
    expect(getTranslationDictionary("en-US")["thread.toolTrace.inputLabel"]).toBe("Input")
    expect(t("zh-CN", "thread.error.title.backendRequestFailed")).toBe("后端请求失败")
    expect(t("zh-CN", "thread.error.message.insufficientBalance")).toBe("余额不足，请充值后重试。")
    expect(t("en-US", "thread.error.message.insufficientBalance")).toBe(
      "Your balance is insufficient. Add funds and try again.",
    )
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
