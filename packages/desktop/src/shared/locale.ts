export const APP_LOCALES = [
  "zh-CN",
  "zh-TW",
  "en-US",
  "ja-JP",
  "ko-KR",
  "pt-BR",
  "es-419",
  "de-DE",
  "fr-FR",
  "id-ID",
  "it-IT",
  "pl-PL",
  "tr-TR",
  "vi-VN",
] as const

export type AppLocale = (typeof APP_LOCALES)[number]

export const APP_LOCALE_METADATA: Record<AppLocale, { label: string; description: string }> = {
  "zh-CN": { label: "简体中文", description: "简体中文界面与 Agent 回复" },
  "zh-TW": { label: "繁體中文", description: "繁體中文介面與 Agent 回覆" },
  "en-US": { label: "English", description: "English interface and Agent responses" },
  "ja-JP": { label: "日本語", description: "日本語のインターフェースと Agent の応答" },
  "ko-KR": { label: "한국어", description: "한국어 인터페이스 및 Agent 응답" },
  "pt-BR": { label: "Português (Brasil)", description: "Interface e respostas do Agent em português do Brasil" },
  "es-419": { label: "Español (Latinoamérica)", description: "Interfaz y respuestas del Agent en español latinoamericano" },
  "de-DE": { label: "Deutsch", description: "Deutsche Benutzeroberfläche und Agent-Antworten" },
  "fr-FR": { label: "Français", description: "Interface et réponses de l’Agent en français" },
  "id-ID": { label: "Bahasa Indonesia", description: "Antarmuka dan respons Agent dalam Bahasa Indonesia" },
  "it-IT": { label: "Italiano", description: "Interfaccia e risposte dell’Agent in italiano" },
  "pl-PL": { label: "Polski", description: "Polski interfejs i odpowiedzi Agenta" },
  "tr-TR": { label: "Türkçe", description: "Türkçe arayüz ve Agent yanıtları" },
  "vi-VN": { label: "Tiếng Việt", description: "Giao diện và phản hồi của Agent bằng tiếng Việt" },
}

const AGENT_RESPONSE_LANGUAGE_NAMES: Record<AppLocale, string> = {
  "zh-CN": "Simplified Chinese",
  "zh-TW": "Traditional Chinese",
  "en-US": "English",
  "ja-JP": "Japanese",
  "ko-KR": "Korean",
  "pt-BR": "Brazilian Portuguese",
  "es-419": "Latin American Spanish",
  "de-DE": "German",
  "fr-FR": "French",
  "id-ID": "Indonesian",
  "it-IT": "Italian",
  "pl-PL": "Polish",
  "tr-TR": "Turkish",
  "vi-VN": "Vietnamese",
}

export function getAgentResponseLanguageInstruction(locale: AppLocale) {
  const language = AGENT_RESPONSE_LANGUAGE_NAMES[locale]
  return [
    `Use ${language} for progress updates and final answers.`,
    "Keep code, commands, paths, identifiers, and quoted text in their original form.",
    "If the user explicitly requests a different response language in the current request, follow that request.",
  ].join(" ")
}

export interface LocaleConfigDocument {
  version: 1
  locale: AppLocale
  updatedAt: number
}

export interface LocaleConfigSnapshot {
  path: string
  exists: boolean
  document: LocaleConfigDocument
}

export const DEFAULT_APP_LOCALE: AppLocale = "zh-CN"

const APP_LOCALE_SET = new Set<string>(APP_LOCALES)

export function isAppLocale(value: string): value is AppLocale {
  return APP_LOCALE_SET.has(value)
}

export function normalizeAppLocale(value: unknown): AppLocale {
  return typeof value === "string" && isAppLocale(value) ? value : DEFAULT_APP_LOCALE
}

export function createDefaultLocaleConfigDocument(): LocaleConfigDocument {
  return {
    version: 1,
    locale: DEFAULT_APP_LOCALE,
    updatedAt: 0,
  }
}

export function normalizeLocaleConfigDocument(input: unknown): LocaleConfigDocument {
  const defaults = createDefaultLocaleConfigDocument()
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return defaults
  }

  const partial = input as Partial<LocaleConfigDocument>
  const updatedAt = typeof partial.updatedAt === "number" && Number.isFinite(partial.updatedAt)
    ? partial.updatedAt
    : 0

  return {
    version: 1,
    locale: normalizeAppLocale(partial.locale),
    updatedAt,
  }
}
