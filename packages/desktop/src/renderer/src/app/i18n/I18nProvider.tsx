import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import {
  APP_LOCALES,
  DEFAULT_APP_LOCALE,
  normalizeAppLocale,
  type AppLocale,
  type LocaleConfigDocument,
} from "../../../../shared/locale"
import { getLiteralVariants, t as translateKey, translateLiteral, type TranslationKey } from "./translations"

const LOCALE_STORAGE_KEY = "desktop.locale"
const LOCALIZABLE_ATTRIBUTES = ["aria-label", "title", "placeholder", "alt"] as const

interface I18nContextValue {
  error: string | null
  isLoading: boolean
  locale: AppLocale
  setLocale: (locale: AppLocale) => Promise<void>
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
}

const I18nContext = createContext<I18nContextValue>({
  error: null,
  isLoading: false,
  locale: "en-US",
  setLocale: async () => undefined,
  t: (key, params) => translateKey("en-US", key, params),
})

function readCachedLocale() {
  if (typeof window === "undefined") return DEFAULT_APP_LOCALE

  try {
    return normalizeAppLocale(window.localStorage.getItem(LOCALE_STORAGE_KEY))
  } catch {
    return DEFAULT_APP_LOCALE
  }
}

function cacheLocale(locale: AppLocale) {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  } catch {
    // Ignore storage failures; the persisted Electron config is authoritative.
  }
}

function createLocaleDocument(locale: AppLocale): LocaleConfigDocument {
  return {
    version: 1,
    locale,
    updatedAt: Date.now(),
  }
}

function shouldSkipTextNode(node: Text) {
  const parent = node.parentElement
  if (!parent) return true

  return Boolean(parent.closest("script, style, textarea, code, pre, [contenteditable='true'], [data-lexical-editor], [data-i18n-skip], .xterm"))
}

function isRenderedVariant(source: string, rendered: string) {
  const trimmed = rendered.trim()
  if (!trimmed) return true

  if (getLiteralVariants(source).has(trimmed)) return true
  return APP_LOCALES.some((locale) => translateLiteral(locale, source).trim() === trimmed)
}

function localizeTextNode(node: Text, locale: AppLocale, textSources: WeakMap<Text, string>) {
  if (shouldSkipTextNode(node)) return

  const current = node.nodeValue ?? ""
  if (!current.trim()) return

  const storedSource = textSources.get(node)
  const source = storedSource && isRenderedVariant(storedSource, current) ? storedSource : current
  textSources.set(node, source)

  const translated = translateLiteral(locale, source)
  if (translated !== current) {
    node.nodeValue = translated
  }
}

function localizeElementAttributes(
  element: Element,
  locale: AppLocale,
  attributeSources: WeakMap<Element, Partial<Record<(typeof LOCALIZABLE_ATTRIBUTES)[number], string>>>,
) {
  if (element.closest("[data-i18n-skip], .xterm")) return

  const sources = attributeSources.get(element) ?? {}
  let didChangeSources = false

  for (const attribute of LOCALIZABLE_ATTRIBUTES) {
    const current = element.getAttribute(attribute)
    if (!current?.trim()) continue

    const storedSource = sources[attribute]
    const source = storedSource && isRenderedVariant(storedSource, current) ? storedSource : current
    if (sources[attribute] !== source) {
      sources[attribute] = source
      didChangeSources = true
    }

    const translated = translateLiteral(locale, source)
    if (translated !== current) {
      element.setAttribute(attribute, translated)
    }
  }

  if (didChangeSources) {
    attributeSources.set(element, sources)
  }
}

function localizeTree(
  root: Element,
  locale: AppLocale,
  textSources: WeakMap<Text, string>,
  attributeSources: WeakMap<Element, Partial<Record<(typeof LOCALIZABLE_ATTRIBUTES)[number], string>>>,
) {
  localizeElementAttributes(root, locale, attributeSources)

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let current = walker.nextNode()
  while (current) {
    localizeTextNode(current as Text, locale, textSources)
    current = walker.nextNode()
  }

  for (const element of root.querySelectorAll("*")) {
    localizeElementAttributes(element, locale, attributeSources)
  }
}

function LocalizedDomBoundary({ children, locale }: { children: ReactNode; locale: AppLocale }) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const textSourcesRef = useRef(new WeakMap<Text, string>())
  const attributeSourcesRef = useRef(
    new WeakMap<Element, Partial<Record<(typeof LOCALIZABLE_ATTRIBUTES)[number], string>>>(),
  )

  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    localizeTree(root, locale, textSourcesRef.current, attributeSourcesRef.current)
  }, [locale])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    let animationFrame = 0
    const pendingTextNodes = new Set<Text>()
    const pendingAttributeElements = new Set<Element>()
    const pendingTreeElements = new Set<Element>()

    const scheduleLocalize = () => {
      if (typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(animationFrame)
      } else {
        window.clearTimeout(animationFrame)
      }

      const schedule =
        typeof window.requestAnimationFrame === "function"
          ? window.requestAnimationFrame
          : (callback: FrameRequestCallback) => window.setTimeout(() => callback(Date.now()), 0)

      animationFrame = schedule(() => {
        const textNodes = Array.from(pendingTextNodes)
        const attributeElements = Array.from(pendingAttributeElements)
        const treeElements = Array.from(pendingTreeElements)

        pendingTextNodes.clear()
        pendingAttributeElements.clear()
        pendingTreeElements.clear()

        for (const textNode of textNodes) {
          localizeTextNode(textNode, locale, textSourcesRef.current)
        }
        for (const element of attributeElements) {
          localizeElementAttributes(element, locale, attributeSourcesRef.current)
        }
        for (const element of treeElements) {
          localizeTree(element, locale, textSourcesRef.current, attributeSourcesRef.current)
        }
      })
    }
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData" && mutation.target instanceof Text) {
          pendingTextNodes.add(mutation.target)
        }
        if (mutation.type === "attributes" && mutation.target instanceof Element) {
          pendingAttributeElements.add(mutation.target)
        }
        if (mutation.type === "childList") {
          for (const node of mutation.addedNodes) {
            if (node instanceof Text) {
              pendingTextNodes.add(node)
            } else if (node instanceof Element) {
              pendingTreeElements.add(node)
            }
          }
        }
      }

      if (pendingTextNodes.size > 0 || pendingAttributeElements.size > 0 || pendingTreeElements.size > 0) {
        scheduleLocalize()
      }
    })

    observer.observe(root, {
      attributeFilter: [...LOCALIZABLE_ATTRIBUTES],
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    })

    return () => {
      observer.disconnect()
      if (typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(animationFrame)
      } else {
        window.clearTimeout(animationFrame)
      }
    }
  }, [locale])

  return (
    <div ref={rootRef} style={{ display: "contents" }}>
      {children}
    </div>
  )
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<AppLocale>(readCachedLocale)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    document.documentElement.lang = locale
    cacheLocale(locale)
  }, [locale])

  useEffect(() => {
    let mounted = true
    const getLocaleConfig = window.desktop?.getLocaleConfig
    if (!getLocaleConfig) return

    setIsLoading(true)
    void getLocaleConfig()
      .then((snapshot) => {
        if (!mounted) return
        setLocaleState(normalizeAppLocale(snapshot.document.locale))
        setError(null)
      })
      .catch((loadError) => {
        if (!mounted) return
        setError(loadError instanceof Error ? loadError.message : String(loadError))
      })
      .finally(() => {
        if (mounted) setIsLoading(false)
      })

    return () => {
      mounted = false
    }
  }, [])

  const setLocale = useCallback(async (nextLocale: AppLocale) => {
    const normalized = normalizeAppLocale(nextLocale)
    setLocaleState(normalized)
    setError(null)

    try {
      await window.desktop?.saveLocaleConfig?.({
        document: createLocaleDocument(normalized),
      })
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError))
    }
  }, [])

  const translate = useCallback(
    (key: TranslationKey, params?: Record<string, string | number>) => translateKey(locale, key, params),
    [locale],
  )

  const value = useMemo<I18nContextValue>(
    () => ({
      error,
      isLoading,
      locale,
      setLocale,
      t: translate,
    }),
    [error, isLoading, locale, setLocale, translate],
  )

  return (
    <I18nContext.Provider value={value}>
      <LocalizedDomBoundary locale={locale}>{children}</LocalizedDomBoundary>
    </I18nContext.Provider>
  )
}

export function useI18n() {
  return useContext(I18nContext)
}
