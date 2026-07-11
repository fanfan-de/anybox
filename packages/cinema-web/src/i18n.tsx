import { createContext, useContext, useMemo, type ReactNode } from "react"

export type Locale = "zh-CN" | "en-US"

const enUS = {
  "text.type": "Text",
  "text.empty": "Double-click to enter text",
  "text.placeholder": "Story note, idea, or narration text.",
  "text.edit": "Edit text",
  "text.generate": "Generate text",
  "text.generating": "Generating text",
  "text.more": "More actions",
  "text.actions": "Text node actions",
  "text.failed": "Text generation failed",
  "text.copy": "Copy text",
  "text.download": "Download text",
  "text.rename": "Rename",
  "text.delete": "Delete node",
  "text.deleteConfirm": "Delete this text node? This action cannot be undone.",
  "text.inputPort": "Reference media input",
  "text.outputPort": "Text output",
  "text.generatorTitle": "Text generation",
  "text.generatorClose": "Close generation panel",
  "text.generatorPrompt": "Describe the text you want to generate...",
  "text.referenceImages": "Reference images: {count}",
  "text.chooseReferenceImages": "Choose reference images",
  "text.referenceEmpty": "Connect an image node, or choose one or more images here",
  "text.addReferenceImage": "Add Text reference image",
  "text.localReferenceImage": "Choose reference images from this device",
  "text.availableReferenceImages": "Available reference images",
  "text.selectReferenceImage": "Select reference image {name}",
  "text.removeReferenceImage": "Remove reference image {name}",
  "text.chooseModel": "Model",
  "text.noModel": "No model",
  "text.noModels": "No text models available",
  "text.noModelTitle": "No text model is available",
  "text.generated": "Text replaced",
  "text.undo": "Undo",
  "text.undoUnavailable": "The generated text has changed and can no longer be restored.",
  "text.generationFailed": "Text generation failed",
  "text.nodeTitle": "Node title",
  "connection.self": "A node cannot connect to itself.",
  "connection.duplicate": "This connection already exists.",
  "connection.textInput": "Text reference input only accepts image nodes.",
  "connection.textOutput": "Text output can only connect to image or video inputs.",
  "connection.videoImageLimit": "A video node accepts at most two image inputs: first frame and last frame.",
  "connection.invalid": "These ports are not compatible.",
} as const

const zhCN: Record<keyof typeof enUS, string> = {
  "text.type": "Text",
  "text.empty": "双击输入文本",
  "text.placeholder": "剧情备注、创意或旁白文本。",
  "text.edit": "编辑文本",
  "text.generate": "生成文本",
  "text.generating": "正在生成文本",
  "text.more": "更多操作",
  "text.actions": "文本节点操作",
  "text.failed": "文本生成失败",
  "text.copy": "复制文本",
  "text.download": "下载文本",
  "text.rename": "重命名",
  "text.delete": "删除节点",
  "text.deleteConfirm": "删除这个文本节点？此操作无法撤销。",
  "text.inputPort": "参考素材输入",
  "text.outputPort": "文本输出",
  "text.generatorTitle": "文本生成",
  "text.generatorClose": "关闭生成面板",
  "text.generatorPrompt": "描述你想生成的文本内容……",
  "text.referenceImages": "参考图：{count} 张",
  "text.chooseReferenceImages": "选择参考图",
  "text.referenceEmpty": "连接图片节点，或在这里选择一张或多张图片",
  "text.addReferenceImage": "添加 Text 参考图",
  "text.localReferenceImage": "从本机选择参考图",
  "text.availableReferenceImages": "可用参考图",
  "text.selectReferenceImage": "选择参考图 {name}",
  "text.removeReferenceImage": "移除参考图 {name}",
  "text.chooseModel": "模型",
  "text.noModel": "无可用模型",
  "text.noModels": "暂无可用文本模型",
  "text.noModelTitle": "没有可用文本模型",
  "text.generated": "正文已替换",
  "text.undo": "撤销",
  "text.undoUnavailable": "生成后的正文已发生变化，无法恢复。",
  "text.generationFailed": "文本生成失败",
  "text.nodeTitle": "节点标题",
  "connection.self": "节点不能连接到自身。",
  "connection.duplicate": "这条连接已经存在。",
  "connection.textInput": "文本节点的参考素材输入只接受图片节点。",
  "connection.textOutput": "文本输出只能连接到图片或视频输入。",
  "connection.videoImageLimit": "视频节点最多接受两张图片：首帧和尾帧。",
  "connection.invalid": "这两个端口不兼容。",
}

export type TranslationKey = keyof typeof enUS
export type TranslationParams = Record<string, string | number>

export function resolveLocale(language: string | null | undefined): Locale {
  return language?.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US"
}

export function translate(locale: Locale, key: TranslationKey, params: TranslationParams = {}): string {
  const template = (locale === "zh-CN" ? zhCN : enUS)[key] ?? enUS[key] ?? key
  return template.replace(/\{([^}]+)\}/g, (match, name: string) => (
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
  ))
}

type I18nContextValue = {
  locale: Locale
  t: (key: TranslationKey, params?: TranslationParams) => string
}

const I18nContext = createContext<I18nContextValue | null>(null)

export function I18nProvider({ children, locale: localeOverride }: { children: ReactNode; locale?: Locale }) {
  const locale = localeOverride ?? resolveLocale(typeof navigator === "undefined" ? undefined : navigator.language)
  const value = useMemo<I18nContextValue>(() => ({
    locale,
    t: (key, params) => translate(locale, key, params),
  }), [locale])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext)
  if (!context) throw new Error("useI18n must be used inside I18nProvider")
  return context
}
