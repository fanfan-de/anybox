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
  "zh-CN": { label: "简体中文", description: "简体中文界面" },
  "zh-TW": { label: "繁體中文", description: "繁體中文介面" },
  "en-US": { label: "English", description: "English interface" },
  "ja-JP": { label: "日本語", description: "日本語インターフェース" },
  "ko-KR": { label: "한국어", description: "한국어 인터페이스" },
  "pt-BR": { label: "Português (Brasil)", description: "Interface em português do Brasil" },
  "es-419": { label: "Español (Latinoamérica)", description: "Interfaz en español latinoamericano" },
  "de-DE": { label: "Deutsch", description: "Deutsche Benutzeroberfläche" },
  "fr-FR": { label: "Français", description: "Interface en français" },
  "id-ID": { label: "Bahasa Indonesia", description: "Antarmuka Bahasa Indonesia" },
  "it-IT": { label: "Italiano", description: "Interfaccia in italiano" },
  "pl-PL": { label: "Polski", description: "Interfejs w języku polskim" },
  "tr-TR": { label: "Türkçe", description: "Türkçe arayüz" },
  "vi-VN": { label: "Tiếng Việt", description: "Giao diện tiếng Việt" },
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
