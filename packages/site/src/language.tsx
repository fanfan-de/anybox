import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"

export type SiteLanguage = "zh" | "en"

const storageKey = "anybox-site-language"

type LanguageContextValue = {
  language: SiteLanguage
  setLanguage: (language: SiteLanguage) => void
}

const LanguageContext = createContext<LanguageContextValue | undefined>(undefined)

function isSiteLanguage(value: string | null): value is SiteLanguage {
  return value === "zh" || value === "en"
}

function getInitialLanguage(): SiteLanguage {
  const queryLanguage = new URLSearchParams(window.location.search).get("lang")
  if (isSiteLanguage(queryLanguage)) return queryLanguage

  const savedLanguage = window.localStorage.getItem(storageKey)
  if (isSiteLanguage(savedLanguage)) return savedLanguage

  return window.navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en"
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<SiteLanguage>(getInitialLanguage)

  useEffect(() => {
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en"
  }, [language])

  function setLanguage(nextLanguage: SiteLanguage) {
    setLanguageState(nextLanguage)
    window.localStorage.setItem(storageKey, nextLanguage)

    const url = new URL(window.location.href)
    url.searchParams.set("lang", nextLanguage)
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`)
  }

  const value = useMemo(() => ({ language, setLanguage }), [language])

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useSiteLanguage() {
  const context = useContext(LanguageContext)

  if (!context) {
    throw new Error("useSiteLanguage must be used inside LanguageProvider")
  }

  return context
}

export function LanguageSwitcher() {
  const { language, setLanguage } = useSiteLanguage()
  const label = language === "zh" ? "选择网站语言" : "Choose website language"

  return (
    <div className="language-switcher" role="group" aria-label={label}>
      <button
        aria-pressed={language === "zh"}
        className={language === "zh" ? "is-active" : undefined}
        onClick={() => setLanguage("zh")}
        type="button"
      >
        中文
      </button>
      <button
        aria-pressed={language === "en"}
        className={language === "en" ? "is-active" : undefined}
        onClick={() => setLanguage("en")}
        type="button"
      >
        EN
      </button>
    </div>
  )
}
