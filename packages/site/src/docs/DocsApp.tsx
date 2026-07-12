import { useEffect, useMemo, useState } from "react"
import { marked, Renderer } from "marked"
import { AtmosphereBackground } from "../AtmosphereBackground"
import {
  docsSectionsByLanguage,
  getDocsArticle,
  getDocsArticles,
  type DocsArticle,
} from "./docsContent"
import { InstallerDownloadButton } from "../InstallerDownloadButton"
import {
  LanguageSwitcher,
  type SiteLanguage,
  useSiteLanguage,
} from "../language"
import { repositoryUrl } from "../releaseDownloads"

const brandLogoBlack = "/brand-logo-black.svg"

type DocsHeading = {
  id: string
  level: number
  text: string
}

function getSlugFromUrl() {
  return new URLSearchParams(window.location.search).get("doc")
}

function cleanHeadingText(text: string) {
  return text
    .replace(/\s+#+$/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[`*_~]/g, "")
    .trim()
}

function slugifyHeading(text: string) {
  return (
    cleanHeadingText(text)
      .toLowerCase()
      .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
      .replace(/^-+|-+$/g, "") || "section"
  )
}

function extractHeadings(markdown: string) {
  const seen = new Map<string, number>()
  const headings: DocsHeading[] = []
  const headingPattern = /^(#{1,6})\s+(.+)$/gm

  for (const match of markdown.matchAll(headingPattern)) {
    const level = match[1].length
    const text = cleanHeadingText(match[2])
    const baseId = slugifyHeading(text)
    const count = seen.get(baseId) ?? 0
    const id = count === 0 ? baseId : `${baseId}-${count + 1}`

    seen.set(baseId, count + 1)
    headings.push({ id, level, text })
  }

  return headings
}

function renderMarkdown(markdown: string, headings: DocsHeading[]) {
  const renderer = new Renderer()
  let headingIndex = 0

  renderer.heading = ({ tokens, depth }) => {
    const text = renderer.parser.parseInline(tokens)
    const id = headings[headingIndex]?.id
    headingIndex += 1

    if (!id) return `<h${depth}>${text}</h${depth}>`

    return `<h${depth} id="${id}">${text}</h${depth}>`
  }

  return marked.parse(markdown, {
    async: false,
    gfm: true,
    renderer,
  })
}

function useCurrentArticle(language: SiteLanguage) {
  const [requestedSlug, setRequestedSlug] = useState(() => getSlugFromUrl())
  const currentArticle =
    getDocsArticle(requestedSlug, language) ?? getDocsArticles(language)[0]

  useEffect(() => {
    const handleLocationChange = () => setRequestedSlug(getSlugFromUrl())

    window.addEventListener("popstate", handleLocationChange)

    return () => {
      window.removeEventListener("popstate", handleLocationChange)
    }
  }, [])

  function navigateToArticle(article: DocsArticle) {
    const url = new URL(window.location.href)

    url.searchParams.set("doc", article.slug)
    url.hash = ""
    window.history.pushState({}, "", `${url.pathname}${url.search}`)
    setRequestedSlug(article.slug)
    window.scrollTo({ top: 0 })
  }

  return {
    currentArticle,
    navigateToArticle,
  }
}

function DocsHeader() {
  const { language } = useSiteLanguage()
  const isChinese = language === "zh"

  return (
    <header className="site-header docs-header">
      <a
        className="brand-lockup"
        href="/"
        aria-label={isChinese ? "返回 Anybox 首页" : "Back to Anybox home"}
      >
        <img src={brandLogoBlack} alt="" />
        <span>Anybox</span>
      </a>
      <nav
        className="docs-header-nav"
        aria-label={isChinese ? "文档导航" : "Documentation navigation"}
      >
        <a href="/">{isChinese ? "首页" : "Home"}</a>
        <a href={repositoryUrl} target="_blank" rel="noreferrer">
          GitHub
        </a>
        <InstallerDownloadButton
          className="button button-primary docs-download-button"
          platform="windows"
        >
          {isChinese ? "Windows 下载" : "Download for Windows"}
        </InstallerDownloadButton>
        <InstallerDownloadButton
          className="button button-secondary docs-download-button"
          platform="mac"
        >
          {isChinese ? "macOS 下载" : "Download for macOS"}
        </InstallerDownloadButton>
        <InstallerDownloadButton
          className="button button-secondary docs-download-button"
          platform="mobile"
        >
          {isChinese ? "Android 下载" : "Download for Android"}
        </InstallerDownloadButton>
      </nav>
      <LanguageSwitcher />
    </header>
  )
}

function DocsSidebar({
  currentArticle,
  language,
  onSelectArticle,
}: {
  currentArticle: DocsArticle
  language: SiteLanguage
  onSelectArticle: (article: DocsArticle) => void
}) {
  const sections = docsSectionsByLanguage[language]

  return (
    <aside
      className="docs-sidebar"
      aria-label={language === "zh" ? "文档目录" : "Documentation index"}
    >
      <div className="docs-sidebar-inner">
        <p>{language === "zh" ? "文档" : "Docs"}</p>
        {sections.map((section) => (
          <div className="docs-nav-section" key={section.title}>
            <span>{section.title}</span>
            {section.items.map((article) => (
              <button
                className={
                  article.slug === currentArticle.slug
                    ? "docs-nav-link is-active"
                    : "docs-nav-link"
                }
                key={article.slug}
                onClick={() => onSelectArticle(article)}
                type="button"
              >
                <strong>{article.title}</strong>
              </button>
            ))}
          </div>
        ))}
      </div>
    </aside>
  )
}

function DocsMobileNav({
  currentArticle,
  language,
  onSelectArticle,
}: {
  currentArticle: DocsArticle
  language: SiteLanguage
  onSelectArticle: (article: DocsArticle) => void
}) {
  const articles = getDocsArticles(language)

  return (
    <label className="docs-mobile-nav">
      <span>{language === "zh" ? "当前文档" : "Current article"}</span>
      <select
        value={currentArticle.slug}
        onChange={(event) => {
          const article = getDocsArticle(event.target.value, language)
          if (article) onSelectArticle(article)
        }}
      >
        {articles.map((article) => (
          <option key={article.slug} value={article.slug}>
            {article.title}
          </option>
        ))}
      </select>
    </label>
  )
}

function DocsToc({
  headings,
  language,
}: {
  headings: DocsHeading[]
  language: SiteLanguage
}) {
  const tocHeadings = headings.filter(
    (heading) => heading.level === 2 || heading.level === 3,
  )

  return (
    <aside
      className="docs-toc"
      aria-label={language === "zh" ? "本页目录" : "On this page"}
    >
      <div>
        <p>{language === "zh" ? "本页目录" : "On this page"}</p>
        {tocHeadings.length > 0 ? (
          <nav>
            {tocHeadings.map((heading) => (
              <a
                className={heading.level === 3 ? "is-nested" : undefined}
                href={`#${heading.id}`}
                key={heading.id}
              >
                {heading.text}
              </a>
            ))}
          </nav>
        ) : (
          <span>{language === "zh" ? "暂无目录" : "No sections"}</span>
        )}
      </div>
    </aside>
  )
}

export function DocsApp() {
  const { language } = useSiteLanguage()
  const { currentArticle, navigateToArticle } = useCurrentArticle(language)
  const headings = useMemo(
    () => extractHeadings(currentArticle.content),
    [currentArticle.content],
  )
  const articleHtml = useMemo(
    () => renderMarkdown(currentArticle.content, headings),
    [currentArticle.content, headings],
  )

  useEffect(() => {
    document.title = `${currentArticle.title} - ${language === "zh" ? "Anybox 文档" : "Anybox Docs"}`
  }, [currentArticle.title, language])

  return (
    <main className="docs-page-shell" id="top">
      <AtmosphereBackground />
      <DocsHeader />
      <div className="docs-layout">
        <DocsSidebar
          currentArticle={currentArticle}
          language={language}
          onSelectArticle={navigateToArticle}
        />
        <div className="docs-main-column">
          <DocsMobileNav
            currentArticle={currentArticle}
            language={language}
            onSelectArticle={navigateToArticle}
          />
          <article
            className="docs-content"
            dangerouslySetInnerHTML={{ __html: articleHtml }}
          />
        </div>
        <DocsToc headings={headings} language={language} />
      </div>
    </main>
  )
}
