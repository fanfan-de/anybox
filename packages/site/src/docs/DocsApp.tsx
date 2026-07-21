import {
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { marked, Renderer } from "marked"
import { SiteFooter, SiteHeader } from "../SiteChrome"
import {
  docsSectionsByLanguage,
  getDocsArticle,
  getDocsArticles,
  type DocsArticle,
  type DocsSection,
} from "./docsContent"
import { type SiteLanguage, useSiteLanguage } from "../language"

export type DocsHeading = {
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

function stripDocumentTitle(markdown: string) {
  return markdown.replace(/^\uFEFF?(?:\r?\n)*#\s+[^\r\n]+(?:\r?\n)?/, "")
}

export function extractHeadings(markdown: string) {
  const seen = new Map<string, number>()
  const headings: DocsHeading[] = []

  for (const token of marked.lexer(markdown)) {
    if (token.type !== "heading") continue

    const text = cleanHeadingText(token.text)
    const baseId = slugifyHeading(text)
    const count = seen.get(baseId) ?? 0
    const id = count === 0 ? baseId : `${baseId}-${count + 1}`

    seen.set(baseId, count + 1)
    headings.push({ id, level: token.depth, text })
  }

  return headings
}

export function renderMarkdown(markdown: string, headings: DocsHeading[]) {
  const renderer = new Renderer()
  const renderCode = renderer.code.bind(renderer)
  const renderTable = renderer.table.bind(renderer)
  let headingIndex = 0

  renderer.heading = ({ tokens, depth }) => {
    const text = renderer.parser.parseInline(tokens)
    const id = headings[headingIndex]?.id
    headingIndex += 1

    if (!id) return `<h${depth}>${text}</h${depth}>`

    return `<h${depth} id="${id}">${text}</h${depth}>`
  }

  renderer.code = (token) =>
    renderCode(token).replace("<pre>", '<pre tabindex="0">')

  renderer.table = (token) =>
    `<div class="docs-table-scroll" tabindex="0">${renderTable(token)}</div>`

  return marked.parse(markdown, {
    async: false,
    gfm: true,
    renderer,
  })
}

function getArticleHref(article: DocsArticle, language: SiteLanguage) {
  const params = new URLSearchParams({ doc: article.slug, lang: language })
  return `?${params.toString()}`
}

function shouldNavigateInApp(event: ReactMouseEvent<HTMLAnchorElement>) {
  return (
    event.button === 0 &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey
  )
}

function getReadingMinutes(markdown: string, language: SiteLanguage) {
  const withoutCode = markdown.replace(/```[\s\S]*?```/g, " ")

  if (language === "zh") {
    const hanCharacters = withoutCode.match(/[\p{Script=Han}]/gu)?.length ?? 0
    const latinWords = withoutCode.match(/[A-Za-z0-9]+/g)?.length ?? 0
    return Math.max(1, Math.ceil((hanCharacters + latinWords * 2) / 420))
  }

  const words = withoutCode.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g)?.length ?? 0
  return Math.max(1, Math.ceil(words / 220))
}

function getArticlePosition(language: SiteLanguage, article: DocsArticle) {
  const articles = getDocsArticles(language)
  const index = articles.findIndex((candidate) => candidate.slug === article.slug)
  const section = docsSectionsByLanguage[language].find((candidate) =>
    candidate.items.some((item) => item.slug === article.slug),
  )

  return {
    nextArticle: index >= 0 ? articles[index + 1] : undefined,
    previousArticle: index > 0 ? articles[index - 1] : undefined,
    sectionTitle: section?.title ?? (language === "zh" ? "文档" : "Docs"),
  }
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
    url.searchParams.set("lang", language)
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

function matchesSearch(article: DocsArticle, query: string) {
  const terms = query
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean)

  if (terms.length === 0) return true

  const searchableText = `${article.title} ${article.description} ${article.content}`.toLocaleLowerCase()
  return terms.every((term) => searchableText.includes(term))
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
  const [searchQuery, setSearchQuery] = useState("")
  const sections = useMemo(
    () =>
      docsSectionsByLanguage[language]
        .map((section) => ({
          ...section,
          items: section.items.filter((article) =>
            matchesSearch(article, searchQuery),
          ),
        }))
        .filter((section) => section.items.length > 0),
    [language, searchQuery],
  )
  const resultCount = sections.reduce(
    (total, section) => total + section.items.length,
    0,
  )

  return (
    <aside
      className="docs-sidebar"
      aria-label={language === "zh" ? "文档导航" : "Documentation navigation"}
    >
      <nav
        aria-label={
          language === "zh" ? "文档导航" : "Documentation navigation"
        }
        className="docs-sidebar-inner"
      >
        <p className="docs-sidebar-title">
          {language === "zh" ? "文档" : "Docs"}
        </p>
        <label className="docs-search">
          <span className="visually-hidden">
            {language === "zh" ? "搜索文档" : "Search documentation"}
          </span>
          <span className="docs-search-field">
            <input
              autoComplete="off"
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={language === "zh" ? "搜索文档…" : "Search docs…"}
              type="search"
              value={searchQuery}
            />
            {searchQuery ? (
              <button
                aria-label={language === "zh" ? "清除搜索" : "Clear search"}
                onClick={() => setSearchQuery("")}
                type="button"
              >
                ×
              </button>
            ) : null}
          </span>
        </label>
        {resultCount > 0 ? (
          <div className="docs-nav-sections">
            {sections.map((section) => (
              <DocsNavSection
                currentArticle={currentArticle}
                key={section.title}
                language={language}
                onSelectArticle={(article) => {
                  setSearchQuery("")
                  onSelectArticle(article)
                }}
                section={section}
              />
            ))}
          </div>
        ) : (
          <p className="docs-search-empty" role="status">
            {language === "zh"
              ? `没有找到“${searchQuery}”`
              : `No results for “${searchQuery}”`}
          </p>
        )}
      </nav>
    </aside>
  )
}

function DocsNavSection({
  currentArticle,
  language,
  onSelectArticle,
  section,
}: {
  currentArticle: DocsArticle
  language: SiteLanguage
  onSelectArticle: (article: DocsArticle) => void
  section: DocsSection
}) {
  return (
    <section className="docs-nav-section">
      <h2>{section.title}</h2>
      <ul>
        {section.items.map((article) => (
          <li key={article.slug}>
            <a
              aria-current={
                article.slug === currentArticle.slug ? "page" : undefined
              }
              className={
                article.slug === currentArticle.slug
                  ? "docs-nav-link is-active"
                  : "docs-nav-link"
              }
              href={getArticleHref(article, language)}
              onClick={(event) => {
                if (!shouldNavigateInApp(event)) return
                event.preventDefault()
                onSelectArticle(article)
              }}
            >
              {article.title}
            </a>
          </li>
        ))}
      </ul>
    </section>
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
  const sections = docsSectionsByLanguage[language]

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
        {sections.map((section) => (
          <optgroup key={section.title} label={section.title}>
            {section.items.map((article) => (
              <option key={article.slug} value={article.slug}>
                {article.title}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  )
}

function useActiveHeading(headings: DocsHeading[]) {
  const [activeHeadingId, setActiveHeadingId] = useState(
    () => window.location.hash.slice(1) || headings[0]?.id,
  )

  useEffect(() => {
    setActiveHeadingId(window.location.hash.slice(1) || headings[0]?.id)

    const updateActiveHeading = () => {
      const elements = headings
        .map((heading) => document.getElementById(heading.id))
        .filter((element): element is HTMLElement => Boolean(element))
      const current = elements
        .filter((element) => element.getBoundingClientRect().top <= 132)
        .at(-1)

      setActiveHeadingId(current?.id ?? elements[0]?.id)
    }

    window.addEventListener("hashchange", updateActiveHeading)
    window.addEventListener("scroll", updateActiveHeading, { passive: true })
    updateActiveHeading()

    return () => {
      window.removeEventListener("hashchange", updateActiveHeading)
      window.removeEventListener("scroll", updateActiveHeading)
    }
  }, [headings])

  return activeHeadingId
}

function DocsTocLinks({
  activeHeadingId,
  headings,
}: {
  activeHeadingId?: string
  headings: DocsHeading[]
}) {
  return (
    <nav>
      {headings.map((heading) => (
        <a
          aria-current={activeHeadingId === heading.id ? "location" : undefined}
          className={heading.level === 3 ? "is-nested" : undefined}
          href={`#${heading.id}`}
          key={heading.id}
        >
          {heading.text}
        </a>
      ))}
    </nav>
  )
}

function DocsToc({
  headings,
  language,
}: {
  headings: DocsHeading[]
  language: SiteLanguage
}) {
  const tocHeadings = useMemo(
    () =>
      headings.filter(
        (heading) => heading.level === 2 || heading.level === 3,
      ),
    [headings],
  )
  const activeHeadingId = useActiveHeading(tocHeadings)

  return (
    <aside
      className="docs-toc"
      aria-label={language === "zh" ? "本页目录" : "On this page"}
    >
      <div>
        <p>{language === "zh" ? "本页目录" : "On this page"}</p>
        {tocHeadings.length > 0 ? (
          <DocsTocLinks
            activeHeadingId={activeHeadingId}
            headings={tocHeadings}
          />
        ) : (
          <span>{language === "zh" ? "暂无目录" : "No sections"}</span>
        )}
      </div>
    </aside>
  )
}

function DocsInlineToc({
  headings,
  language,
}: {
  headings: DocsHeading[]
  language: SiteLanguage
}) {
  const tocHeadings = headings.filter(
    (heading) => heading.level === 2 || heading.level === 3,
  )

  if (tocHeadings.length === 0) return null

  return (
    <details className="docs-inline-toc">
      <summary>{language === "zh" ? "本页目录" : "On this page"}</summary>
      <DocsTocLinks headings={tocHeadings} />
    </details>
  )
}

function DocsArticlePager({
  language,
  nextArticle,
  onSelectArticle,
  previousArticle,
}: {
  language: SiteLanguage
  nextArticle?: DocsArticle
  onSelectArticle: (article: DocsArticle) => void
  previousArticle?: DocsArticle
}) {
  if (!previousArticle && !nextArticle) return null

  const renderLink = (article: DocsArticle, direction: "next" | "previous") => (
    <a
      className={`docs-pager-link is-${direction}`}
      href={getArticleHref(article, language)}
      onClick={(event) => {
        if (!shouldNavigateInApp(event)) return
        event.preventDefault()
        onSelectArticle(article)
      }}
    >
      <span>
        {direction === "previous"
          ? language === "zh"
            ? "上一篇"
            : "Previous"
          : language === "zh"
            ? "下一篇"
            : "Next"}
      </span>
      <strong>{article.title}</strong>
      <small>{article.description}</small>
    </a>
  )

  return (
    <nav
      aria-label={language === "zh" ? "文章分页" : "Article pagination"}
      className="docs-pager"
    >
      {previousArticle ? renderLink(previousArticle, "previous") : <span />}
      {nextArticle ? renderLink(nextArticle, "next") : <span />}
    </nav>
  )
}

export function DocsApp() {
  const { language } = useSiteLanguage()
  const { currentArticle, navigateToArticle } = useCurrentArticle(language)
  const articleBody = useMemo(
    () => stripDocumentTitle(currentArticle.content),
    [currentArticle.content],
  )
  const headings = useMemo(() => extractHeadings(articleBody), [articleBody])
  const articleHtml = useMemo(
    () => renderMarkdown(articleBody, headings),
    [articleBody, headings],
  )
  const articlePosition = getArticlePosition(language, currentArticle)
  const readingMinutes = getReadingMinutes(currentArticle.content, language)
  const articleTitleRef = useRef<HTMLHeadingElement>(null)
  const previousSlugRef = useRef(currentArticle.slug)

  useEffect(() => {
    document.title = `${currentArticle.title} - ${language === "zh" ? "Anybox 文档" : "Anybox Docs"}`

    const description = document.querySelector<HTMLMetaElement>(
      'meta[name="description"]',
    )
    description?.setAttribute("content", currentArticle.description)
  }, [currentArticle.description, currentArticle.title, language])

  useEffect(() => {
    if (previousSlugRef.current !== currentArticle.slug) {
      articleTitleRef.current?.focus()
      previousSlugRef.current = currentArticle.slug
    }
  }, [currentArticle.slug])

  return (
    <div className="docs-page-shell" id="top">
      <a className="docs-skip-link" href="#main-content">
        {language === "zh" ? "跳到正文" : "Skip to content"}
      </a>
      <SiteHeader currentPage="docs" />
      <main className="docs-layout" id="main-content">
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
          <article aria-labelledby="docs-article-title" className="docs-article">
            <header className="docs-article-header">
              <p className="docs-article-meta">
                <span>{articlePosition.sectionTitle}</span>
                <span aria-hidden="true">·</span>
                <span>
                  {language === "zh"
                    ? `约 ${readingMinutes} 分钟阅读`
                    : `${readingMinutes} min read`}
                </span>
              </p>
              <h1 id="docs-article-title" ref={articleTitleRef} tabIndex={-1}>
                {currentArticle.title}
              </h1>
              <p className="docs-article-description">
                {currentArticle.description}
              </p>
            </header>
            <DocsInlineToc headings={headings} language={language} />
            <div
              className="docs-content"
              dangerouslySetInnerHTML={{ __html: articleHtml }}
            />
            <DocsArticlePager
              language={language}
              nextArticle={articlePosition.nextArticle}
              onSelectArticle={navigateToArticle}
              previousArticle={articlePosition.previousArticle}
            />
          </article>
          <p aria-live="polite" className="visually-hidden">
            {language === "zh"
              ? `已打开：${currentArticle.title}`
              : `Opened: ${currentArticle.title}`}
          </p>
        </div>
        <DocsToc headings={headings} language={language} />
      </main>
      <SiteFooter />
    </div>
  )
}
