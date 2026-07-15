import { useEffect, useState } from "react"
import { DownloadCta } from "./DownloadCta"
import { ProductMedia } from "./ProductMedia"
import { RibbonBackground } from "./RibbonBackground"
import { SiteFooter, SiteHeader } from "./SiteChrome"
import { siteContent } from "./content"
import { useSiteLanguage } from "./language"
import { repositoryUrl, releasesUrl } from "./releaseDownloads"
import { trackSiteEvent } from "./siteAnalytics"

type RepositorySummary = {
  latestRelease?: string
  publishedAt?: string
  stars?: number
}

function formatStars(stars: number | undefined) {
  if (stars === undefined) return "—"
  if (stars < 1000) return String(stars)
  return `${(stars / 1000).toFixed(stars < 10000 ? 1 : 0)}K`
}

function useRepositorySummary() {
  const [summary, setSummary] = useState<RepositorySummary>({})

  useEffect(() => {
    const controller = new AbortController()

    Promise.all([
      fetch("https://api.github.com/repos/fanfan-de/anybox", {
        headers: { Accept: "application/vnd.github+json" },
        signal: controller.signal,
      }),
      fetch("https://api.github.com/repos/fanfan-de/anybox/releases/latest", {
        headers: { Accept: "application/vnd.github+json" },
        signal: controller.signal,
      }),
    ])
      .then(async ([repositoryResponse, releaseResponse]) => {
        const repository = repositoryResponse.ok
          ? ((await repositoryResponse.json()) as { stargazers_count?: unknown })
          : undefined
        const release = releaseResponse.ok
          ? ((await releaseResponse.json()) as { published_at?: unknown; tag_name?: unknown })
          : undefined

        setSummary({
          latestRelease: typeof release?.tag_name === "string" ? release.tag_name : undefined,
          publishedAt: typeof release?.published_at === "string" ? release.published_at : undefined,
          stars: typeof repository?.stargazers_count === "number" ? repository.stargazers_count : undefined,
        })
      })
      .catch(() => {})

    return () => controller.abort()
  }, [])

  return summary
}

function useHomeMetadata(language: "zh" | "en") {
  const content = siteContent[language]

  useEffect(() => {
    const title = language === "zh"
      ? "Anybox｜开源的本地 AI Agent 工作台"
      : "Anybox | Open-source local AI agent workspace"
    const description = content.hero.description
    const setMeta = (selector: string, value: string) => {
      document.querySelector<HTMLMetaElement>(selector)?.setAttribute("content", value)
    }

    document.title = title
    setMeta('meta[name="description"]', description)
    setMeta('meta[property="og:title"]', title)
    setMeta('meta[property="og:description"]', description)
    setMeta('meta[name="twitter:title"]', title)
    setMeta('meta[name="twitter:description"]', description)

    const scriptId = "anybox-software-schema"
    document.getElementById(scriptId)?.remove()
    const schema = document.createElement("script")
    schema.id = scriptId
    schema.type = "application/ld+json"
    schema.text = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      applicationCategory: "DeveloperApplication",
      description,
      name: "Anybox",
      operatingSystem: "Windows, macOS, Linux, Android",
      url: "https://anybox.com.cn/",
    })
    document.head.appendChild(schema)

    return () => schema.remove()
  }, [content.hero.description, language])
}

export function App() {
  const { language } = useSiteLanguage()
  const content = siteContent[language]
  const repository = useRepositorySummary()
  const releaseDate = repository.publishedAt
    ? new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en", {
        dateStyle: "medium",
      }).format(new Date(repository.publishedAt))
    : "—"

  useHomeMetadata(language)

  return (
    <main className="page-shell home-page-shell" id="top">
      <SiteHeader currentPage="home" />

      <section className="home-hero" aria-labelledby="hero-title">
        <RibbonBackground />
        <div className="home-hero-inner">
          <div className="home-hero-copy">
            <p className="home-hero-wordmark" aria-hidden="true">Anybox</p>
            <h1 id="hero-title">
              {language === "zh" ? (
                <>
                  <span className="home-hero-title-kicker">面向 AI builder 的通用 Agent 工作台</span>
                  <span className="home-hero-title-formula">
                    <span className="home-hero-title-term">通用 Agent</span>
                    <span className="home-hero-title-plus">+</span>
                    <span className="home-hero-title-term">领域化插件</span>
                    <span>架构，</span>
                  </span>
                  <span className="home-hero-title-rest">让 Anybox 可以适用于任何任务场景。</span>
                </>
              ) : content.hero.title}
            </h1>
            <div className="home-hero-actions">
              <DownloadCta placement="hero" />
            </div>
            <p className="home-hero-note">{content.hero.note}</p>
          </div>

          <ProductMedia
            alt={content.hero.previewAlt}
            caption={content.hero.previewCaption}
            variant="desktop"
          />
        </div>
      </section>

      <section className="signal-section" id="product" aria-label={language === "zh" ? "产品关键信号" : "Product highlights"}>
        <ul>
          {content.signals.map((signal) => <li key={signal}>{signal}</li>)}
        </ul>
      </section>

      <section className="home-section workflow-section-new" id="workflow" aria-labelledby="workflow-title">
        <div className="home-section-heading">
          <p className="section-kicker">{content.workflow.eyebrow}</p>
          <h2 id="workflow-title">{content.workflow.title}</h2>
          <p>{content.workflow.description}</p>
        </div>
        <ol className="workflow-list">
          {content.workflow.steps.map((step, index) => (
            <li key={step.title}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <div><h3>{step.title}</h3><p>{step.description}</p></div>
            </li>
          ))}
        </ol>
      </section>

      <section className="home-section capability-section" aria-labelledby="capability-title">
        <div className="home-section-heading capability-heading">
          <p className="section-kicker">{content.capabilities.eyebrow}</p>
          <h2 id="capability-title">{content.capabilities.title}</h2>
          <p>{content.capabilities.description}</p>
        </div>
        <div className="capability-list">
          {content.capabilities.items.map((item, index) => (
            <article className={index % 2 === 1 ? "capability-story is-reversed" : "capability-story"} key={item.title}>
              <div className="capability-copy">
                <p className="home-eyebrow">{item.eyebrow}</p>
                <h3>{item.title}</h3>
                <p>{item.description}</p>
              </div>
              <ProductMedia
                alt={item.mediaAlt}
                caption={item.mediaCaption}
                variant={item.mediaVariant}
              />
            </article>
          ))}
        </div>
      </section>

      <section className="home-section use-case-section" aria-labelledby="use-case-title">
        <div className="home-section-heading">
          <p className="section-kicker">{content.useCases.eyebrow}</p>
          <h2 id="use-case-title">{content.useCases.title}</h2>
          <p>{content.useCases.description}</p>
        </div>
        <div className="use-case-list">
          {content.useCases.items.map((item) => (
            <article key={item.title}><h3>{item.title}</h3><p>{item.description}</p></article>
          ))}
        </div>
      </section>

      <section className="home-section trust-section" aria-labelledby="trust-title">
        <div className="trust-copy">
          <p className="section-kicker">{content.trust.eyebrow}</p>
          <h2 id="trust-title">{content.trust.title}</h2>
          <p>{content.trust.description}</p>
          <div className="trust-links">
            <a
              href={repositoryUrl}
              rel="noreferrer"
              target="_blank"
              onClick={() => trackSiteEvent({
                destination: "github",
                language,
                name: "navigation_click",
                placement: "trust",
              })}
            >
              {content.trust.githubLabel}
            </a>
            <a
              href={releasesUrl}
              rel="noreferrer"
              target="_blank"
              onClick={() => trackSiteEvent({
                destination: "releases",
                language,
                name: "navigation_click",
                placement: "trust",
              })}
            >
              {content.trust.releasesLabel}
            </a>
          </div>
        </div>
        <dl className="trust-stats">
          <div><dt>{content.trust.starsLabel}</dt><dd>{formatStars(repository.stars)}</dd></div>
          <div><dt>{content.trust.versionLabel}</dt><dd>{repository.latestRelease ?? "—"}</dd></div>
          <div><dt>{content.trust.updatedLabel}</dt><dd>{releaseDate}</dd></div>
        </dl>
      </section>

      <section className="home-final-cta" aria-labelledby="final-cta-title">
        <p className="section-kicker">{content.finalCta.eyebrow}</p>
        <h2 id="final-cta-title">{content.finalCta.title}</h2>
        <p>{content.finalCta.description}</p>
        <div className="home-final-actions">
          <DownloadCta placement="final" />
          <a
            className="button button-ghost"
            href="/docs/?doc=getting-started"
            onClick={() => trackSiteEvent({
              destination: "docs",
              language,
              name: "navigation_click",
              placement: "final",
            })}
          >
            {content.finalCta.docsLabel}
          </a>
        </div>
      </section>

      <SiteFooter showCommunity />
    </main>
  )
}
