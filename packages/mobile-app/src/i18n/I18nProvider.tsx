import * as SecureStore from "expo-secure-store"
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import {
  DEFAULT_MOBILE_LOCALE,
  localeNames,
  normalizeMobileLocale,
  translations,
  type MobileLocale,
  type MobileTranslationKey,
} from "./translations"

const LOCALE_STORAGE_KEY = "anybox.mobile.locale"

interface I18nContextValue {
  isLoading: boolean
  locale: MobileLocale
  localeLabel: string
  setLocale: (locale: MobileLocale) => Promise<void>
  t: (key: MobileTranslationKey, params?: Record<string, string | number>) => string
}

const I18nContext = createContext<I18nContextValue | undefined>(undefined)

function resolveDeviceLocale(): MobileLocale {
  try {
    const resolved = Intl.DateTimeFormat().resolvedOptions().locale.toLocaleLowerCase()
    if (resolved.startsWith("ja")) return "ja-JP"
    if (resolved.startsWith("ko")) return "ko-KR"
    if (resolved.startsWith("pt")) return "pt-BR"
    if (resolved.startsWith("es")) return "es-419"
    if (resolved.startsWith("de")) return "de-DE"
    if (resolved.startsWith("fr")) return "fr-FR"
    if (resolved.startsWith("id")) return "id-ID"
    if (resolved.startsWith("it")) return "it-IT"
    if (resolved.startsWith("pl")) return "pl-PL"
    if (resolved.startsWith("tr")) return "tr-TR"
    if (resolved.startsWith("vi")) return "vi-VN"
    if (resolved.startsWith("zh")) {
      return /(?:hant|tw|hk|mo)/.test(resolved) ? "zh-TW" : "zh-CN"
    }
    return DEFAULT_MOBILE_LOCALE
  } catch {
    return DEFAULT_MOBILE_LOCALE
  }
}

function interpolate(template: string, params?: Record<string, string | number>) {
  if (!params) return template
  return template.replace(/\{(?<key>[\w.-]+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : match,
  )
}

export function MobileI18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<MobileLocale>(resolveDeviceLocale)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let mounted = true
    SecureStore.getItemAsync(LOCALE_STORAGE_KEY)
      .then((storedLocale) => {
        if (!mounted) return
        setLocaleState(normalizeMobileLocale(storedLocale) ?? resolveDeviceLocale())
      })
      .catch(() => undefined)
      .finally(() => {
        if (mounted) setIsLoading(false)
      })

    return () => {
      mounted = false
    }
  }, [])

  const setLocale = useCallback(async (nextLocale: MobileLocale) => {
    setLocaleState(nextLocale)
    await SecureStore.setItemAsync(LOCALE_STORAGE_KEY, nextLocale)
  }, [])

  const translate = useCallback(
    (key: MobileTranslationKey, params?: Record<string, string | number>) =>
      interpolate(translations[locale][key], params),
    [locale],
  )

  const value = useMemo<I18nContextValue>(
    () => ({
      isLoading,
      locale,
      localeLabel: localeNames[locale],
      setLocale,
      t: translate,
    }),
    [isLoading, locale, setLocale, translate],
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const value = useContext(I18nContext)
  if (!value) throw new Error("useI18n must be used inside MobileI18nProvider.")
  return value
}
