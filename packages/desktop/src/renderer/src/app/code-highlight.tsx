import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react"
import {
  bundledLanguages,
  createHighlighter,
  type BundledTheme,
  type BundledLanguage,
  type Highlighter,
  type ThemedToken,
} from "shiki/bundle/web"
import {
  DEFAULT_DARK_CODE_THEME,
  DEFAULT_LIGHT_CODE_THEME,
  isCodeHighlightTheme,
  type CodeHighlightTheme,
} from "./code-theme"

export interface CodeLanguageInput {
  extension?: string | null
  mime?: string | null
  path?: string | null
  renderer?: string | null
}

interface HighlightedCodeLineProps {
  line: string
  tokens?: readonly ThemedToken[] | null
}

interface CodeBlockPreviewProps {
  className?: string
  content: string
  language?: string | null
  theme?: CodeHighlightTheme
}

interface UseHighlightedCodeInput {
  content: string
  language?: string | null
  theme?: CodeHighlightTheme
}

interface HighlightedCodeState {
  backgroundColor: string | null
  foregroundColor: string | null
  language: string
  themeName: string | null
  tokenLines: ThemedToken[][] | null
}

export const CODE_HIGHLIGHT_MAX_INPUT_LENGTH = 200_000

const INITIAL_SHIKI_THEMES = [DEFAULT_LIGHT_CODE_THEME, DEFAULT_DARK_CODE_THEME] as const satisfies readonly BundledTheme[]

const INITIAL_SHIKI_LANGUAGES = [
  "bash",
  "css",
  "csv",
  "html",
  "javascript",
  "json",
  "jsx",
  "markdown",
  "shell",
  "tsx",
  "typescript",
  "xml",
  "yaml",
] as const satisfies readonly BundledLanguage[]

const EXTENSION_LANGUAGES = new Map([
  ["bash", "shell"],
  ["bat", "batch"],
  ["c", "c"],
  ["cc", "cpp"],
  ["cjs", "javascript"],
  ["cmd", "batch"],
  ["cpp", "cpp"],
  ["cs", "csharp"],
  ["css", "css"],
  ["go", "go"],
  ["h", "c"],
  ["hpp", "cpp"],
  ["htm", "html"],
  ["html", "html"],
  ["java", "java"],
  ["js", "javascript"],
  ["json", "json"],
  ["jsx", "javascript"],
  ["log", "log"],
  ["md", "markdown"],
  ["mdx", "markdown"],
  ["mjs", "javascript"],
  ["ps1", "powershell"],
  ["py", "python"],
  ["rb", "ruby"],
  ["rs", "rust"],
  ["scss", "css"],
  ["sh", "shell"],
  ["sql", "sql"],
  ["svg", "html"],
  ["toml", "toml"],
  ["ts", "typescript"],
  ["tsx", "typescript"],
  ["txt", "text"],
  ["xml", "html"],
  ["yaml", "yaml"],
  ["yml", "yaml"],
])

const FILE_NAME_LANGUAGES = new Map([
  ["dockerfile", "dockerfile"],
  ["makefile", "makefile"],
  ["package.json", "json"],
  ["pnpm-lock.yaml", "yaml"],
  ["tsconfig.json", "json"],
])

const SHIKI_LANGUAGE_IDS = new Set(Object.keys(bundledLanguages))
let highlighterPromise: Promise<Highlighter> | null = null
const loadedLanguages = new Set<string>(INITIAL_SHIKI_LANGUAGES)
const loadedThemes = new Set<string>(INITIAL_SHIKI_THEMES)

function getPathFileName(value: string | null | undefined) {
  const cleanPath = value?.split(/[?#]/)[0]?.trim() ?? ""
  return cleanPath.split(/[\\/]/).filter(Boolean).pop()?.toLowerCase() ?? ""
}

function getPathExtension(value: string | null | undefined) {
  const fileName = getPathFileName(value)
  const dotIndex = fileName.lastIndexOf(".")
  if (dotIndex <= 0 || dotIndex === fileName.length - 1) return null
  return fileName.slice(dotIndex + 1)
}

function normalizeExtension(value: string | null | undefined) {
  return value?.trim().replace(/^\./, "").toLowerCase() || null
}

export function inferCodeLanguage(input: CodeLanguageInput) {
  const fileName = getPathFileName(input.path)
  const namedLanguage = FILE_NAME_LANGUAGES.get(fileName)
  if (namedLanguage) return namedLanguage

  const extension = normalizeExtension(input.extension) ?? getPathExtension(input.path)
  const extensionLanguage = extension ? EXTENSION_LANGUAGES.get(extension) : null
  if (extensionLanguage) return extensionLanguage

  const mime = input.mime?.toLowerCase() ?? ""
  if (mime.includes("json")) return "json"
  if (mime.includes("javascript")) return "javascript"
  if (mime.includes("typescript")) return "typescript"
  if (mime.includes("html") || mime.includes("xml") || mime.includes("svg")) return "html"
  if (mime.includes("css")) return "css"
  if (mime.includes("markdown")) return "markdown"
  if (mime.includes("csv")) return "csv"
  if (input.renderer === "json-viewer") return "json"
  if (input.renderer === "table-preview") return "csv"
  return "text"
}

function getHighlighter() {
  highlighterPromise ??= createHighlighter({
    langs: [...INITIAL_SHIKI_LANGUAGES],
    themes: [...INITIAL_SHIKI_THEMES],
  }).catch((error) => {
    highlighterPromise = null
    throw error
  })
  return highlighterPromise
}

function normalizeShikiLanguage(language: string | null | undefined) {
  const normalized = language?.trim().toLowerCase() || "text"
  if (normalized === "plain" || normalized === "plaintext" || normalized === "txt") return "text"
  return SHIKI_LANGUAGE_IDS.has(normalized) ? normalized : "text"
}

function normalizeShikiTheme(theme: CodeHighlightTheme) {
  return isCodeHighlightTheme(theme) ? theme : DEFAULT_LIGHT_CODE_THEME
}

async function ensureLanguageLoaded(highlighter: Highlighter, language: string) {
  if (language === "text" || loadedLanguages.has(language)) return
  await highlighter.loadLanguage(language as BundledLanguage)
  loadedLanguages.add(language)
}

async function ensureThemeLoaded(highlighter: Highlighter, theme: CodeHighlightTheme) {
  if (loadedThemes.has(theme)) return
  await highlighter.loadTheme(theme as BundledTheme)
  loadedThemes.add(theme)
}

function shouldUsePlainTextFallback(content: string, language: string) {
  return language === "text" || content.length > CODE_HIGHLIGHT_MAX_INPUT_LENGTH
}

export function useHighlightedCode({
  content,
  language,
  theme = DEFAULT_LIGHT_CODE_THEME,
}: UseHighlightedCodeInput): HighlightedCodeState {
  const shikiLanguage = normalizeShikiLanguage(language)
  const shikiTheme = normalizeShikiTheme(theme)
  const [state, setState] = useState<HighlightedCodeState>({
    backgroundColor: null,
    foregroundColor: null,
    language: shikiLanguage,
    themeName: shikiTheme,
    tokenLines: null,
  })

  useEffect(() => {
    let cancelled = false

    if (shouldUsePlainTextFallback(content, shikiLanguage)) {
      setState({
        backgroundColor: null,
        foregroundColor: null,
        language: shikiLanguage,
        themeName: shikiTheme,
        tokenLines: null,
      })
      return () => {
        cancelled = true
      }
    }

    setState({
      backgroundColor: null,
      foregroundColor: null,
      language: shikiLanguage,
      themeName: shikiTheme,
      tokenLines: null,
    })

    void getHighlighter()
      .then(async (highlighter) => {
        await ensureLanguageLoaded(highlighter, shikiLanguage)
        await ensureThemeLoaded(highlighter, shikiTheme)
        if (cancelled) return

        const result = highlighter.codeToTokens(content, {
          lang: shikiLanguage as BundledLanguage,
          theme: shikiTheme as BundledTheme,
        })
        if (!cancelled) {
          setState({
            backgroundColor: result.bg ?? null,
            foregroundColor: result.fg ?? null,
            language: shikiLanguage,
            themeName: result.themeName ?? shikiTheme,
            tokenLines: result.tokens,
          })
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState({
            backgroundColor: null,
            foregroundColor: null,
            language: shikiLanguage,
            themeName: shikiTheme,
            tokenLines: null,
          })
        }
      })

    return () => {
      cancelled = true
    }
  }, [content, shikiLanguage, shikiTheme])

  return state
}

function getTokenStyle(token: ThemedToken) {
  const style: CSSProperties = {}
  const styleRecord = style as Record<string, string>

  for (const [key, value] of Object.entries(token.htmlStyle ?? {})) {
    const reactKey = key.replace(/-([a-z])/g, (_, character: string) => character.toUpperCase())
    styleRecord[reactKey] = value
  }

  if (token.color && !style.color) style.color = token.color
  if (token.bgColor && !style.backgroundColor) style.backgroundColor = token.bgColor

  const fontStyle = token.fontStyle ?? 0
  if (fontStyle > 0) {
    if (fontStyle & 1) style.fontStyle = "italic"
    if (fontStyle & 2) style.fontWeight = 600
    if (fontStyle & 4) style.textDecoration = "underline"
    if (fontStyle & 8) style.textDecoration = style.textDecoration ? `${style.textDecoration} line-through` : "line-through"
  }

  return Object.keys(style).length > 0 ? style : undefined
}

function renderCodeTokens(tokens: readonly ThemedToken[] | null | undefined, fallbackLine: string) {
  if (!tokens?.length) return fallbackLine

  return tokens.map((token, index) => (
    <span
      key={`${index}:${token.offset}:${token.content}`}
      className="code-highlight-token"
      style={getTokenStyle(token)}
    >
      {token.content}
    </span>
  ))
}

export function HighlightedCodeLine({ line, tokens }: HighlightedCodeLineProps) {
  if (line.length === 0) return " "
  return (
    <>
      <span className="code-highlight-raw-line" aria-hidden="true">
        {line}
      </span>
      {renderCodeTokens(tokens, line)}
    </>
  )
}

export function CodeBlockPreview({ className, content, language, theme = DEFAULT_LIGHT_CODE_THEME }: CodeBlockPreviewProps) {
  const lines = useMemo(() => content.split(/\r?\n/), [content])
  const highlight = useHighlightedCode({ content, language, theme })
  const classes = ["code-highlight", "code-highlight-block", className].filter(Boolean).join(" ")
  const style = {
    backgroundColor: highlight.backgroundColor ?? undefined,
    color: highlight.foregroundColor ?? undefined,
  }

  return (
    <pre className={classes} data-language={highlight.language} data-theme={highlight.themeName ?? theme} style={style}>
      <code>
        {lines.map((line, index): ReactNode => {
          const lineNumber = index + 1
          return (
            <span key={`${lineNumber}:${line}`} className="code-highlight-row">
              <span className="code-highlight-line-number" aria-hidden="true">
                {String(lineNumber)}
              </span>
              <span className="code-highlight-line-text">
                <HighlightedCodeLine line={line} tokens={highlight.tokenLines?.[index] ?? null} />
              </span>
            </span>
          )
        })}
      </code>
    </pre>
  )
}
