import { useEffect, useState } from "react"
import { DownloadCta } from "./DownloadCta"
import { HomeDemoShowcases } from "./HomeDemoVideo"
import { PaperBackground } from "./PaperBackground"
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

type FaqItem = {
  answer: string
  question: string
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
    const description = content.hero.description || (language === "zh"
      ? "Anybox 开源本地 AI Agent 工作台。"
      : "Anybox open-source local AI agent workspace.")
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

function FaqList({ items }: { items: FaqItem[] }) {
  const [openItems, setOpenItems] = useState<Set<number>>(() => new Set([0]))

  return (
    <div className="faq-list">
      {items.map((item, index) => (
        <details
          className="faq-item"
          key={item.question}
          open={openItems.has(index)}
          onToggle={(event) => {
            const isOpen = event.currentTarget.open

            setOpenItems((current) => {
              if (current.has(index) === isOpen) return current

              const next = new Set(current)
              if (isOpen) next.add(index)
              else next.delete(index)
              return next
            })
          }}
        >
          <summary>{item.question}</summary>
          <p>{item.answer}</p>
        </details>
      ))}
    </div>
  )
}

export function App() {
  const { language } = useSiteLanguage()
  const content = siteContent[language]
  const hasHeroTitle = content.hero.title.length > 0
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

      <section
        aria-label={hasHeroTitle ? undefined : "Anybox"}
        aria-labelledby={hasHeroTitle ? "hero-title" : undefined}
        className="home-hero"
      >
        <PaperBackground />
        <div className="home-hero-inner">
          <div className="home-hero-stage">
            <div className="home-hero-copy">
              <p className="home-hero-wordmark" aria-hidden="true">Anybox</p>
              <p className="home-hero-open-source">{content.hero.eyebrow}</p>
              {hasHeroTitle ? <h1 id="hero-title">{content.hero.title}</h1> : null}
              {content.hero.description
                ? <p className="home-hero-summary">{content.hero.description}</p>
                : null}
              <div className="home-hero-actions">
                <DownloadCta placement="hero" />
                <a
                  className="button button-secondary home-hero-github"
                  href={repositoryUrl}
                  rel="noreferrer"
                  target="_blank"
                  onClick={() => trackSiteEvent({
                    destination: "github",
                    language,
                    name: "navigation_click",
                    placement: "hero",
                  })}
                >
                  {content.hero.githubLabel}
                </a>
              </div>
              <p className="home-hero-note">{content.hero.note}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="home-section trust-section" id="open-source" aria-labelledby="trust-title">
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
          <div><dt>{content.trust.licenseLabel}</dt><dd>MIT</dd></div>
          <div><dt>{content.trust.starsLabel}</dt><dd>{formatStars(repository.stars)}</dd></div>
          <div><dt>{content.trust.versionLabel}</dt><dd>{repository.latestRelease ?? "—"}</dd></div>
          <div><dt>{content.trust.updatedLabel}</dt><dd>{releaseDate}</dd></div>
        </dl>
      </section>

      <section className="home-overview-section" id="product" aria-labelledby="overview-title">
        <div className="home-overview-inner">
          <div className="home-overview-heading">
            <p className="section-kicker">{content.overview.eyebrow}</p>
            <h2 id="overview-title">{content.overview.title}</h2>
            <p>{content.overview.description}</p>
          </div>

          <figure className="home-overview-media">
            <div className="home-overview-frame">
              <img
                alt={language === "zh" ? "Anybox 桌面端本地 Agent 工作台" : "The Anybox local agent desktop workspace"}
                decoding="async"
                height="1389"
                loading="eager"
                src="/product-preview.png"
                width="2558"
              />
            </div>
            <figcaption>
              {language === "zh"
                ? "项目、会话、模型、权限与执行结果保持在同一个工作空间。"
                : "Projects, sessions, models, permissions, and execution results stay in one workspace."}
            </figcaption>
          </figure>

          <ul className="overview-signals" aria-label={language === "zh" ? "产品关键信号" : "Product highlights"}>
            {content.signals.map((signal) => <li key={signal}>{signal}</li>)}
          </ul>

          <ol className="overview-steps">
            {content.overview.steps.map((step, index) => (
              <li key={step.title}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <h3>{step.title}</h3>
                  <p>{step.description}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <HomeDemoShowcases language={language} />

      <section className="home-section plugin-section" id="plugins" aria-labelledby="plugin-title">
        <div className="home-section-heading">
          <p className="section-kicker">{content.plugins.eyebrow}</p>
          <h2 id="plugin-title">{content.plugins.title}</h2>
          <p>{content.plugins.description}</p>
        </div>

        <ol className="plugin-stages">
          {content.plugins.stages.map((stage, index) => (
            <li key={stage.title}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <h3>{stage.title}</h3>
              <p>{stage.description}</p>
            </li>
          ))}
        </ol>

        <div className="plugin-examples">
          {content.plugins.examples.map((example) => (
            <a href={example.href} key={example.name}>
              <strong>{example.name}</strong>
              <span>{example.description}</span>
            </a>
          ))}
        </div>

        <a className="plugin-docs-link" href="/docs/?doc=plugin-development">
          {content.plugins.docsLabel}
        </a>
      </section>

      <section className="scenario-story-section" id="scenarios" aria-labelledby="scenario-title">
        <div className="scenario-story-inner">
          <div className="scenario-story-heading">
            <p className="section-kicker">{content.useCases.eyebrow}</p>
            <h2 id="scenario-title">{content.useCases.title}</h2>
            <p>{content.useCases.description}</p>
          </div>

          <div className="scenario-story-list">
            {content.useCases.items.map((item, index) => (
              <article className={index % 2 === 1 ? "scenario-story is-reversed" : "scenario-story"} key={item.title}>
                <div className="scenario-story-copy">
                  <p className="scenario-story-number">{String(index + 1).padStart(2, "0")}</p>
                  <h3>{item.title}</h3>
                  <p className="scenario-story-description">{item.description}</p>
                  <blockquote>
                    <span>{language === "zh" ? "任务" : "Task"}</span>
                    <p>{item.prompt}</p>
                  </blockquote>
                  <ul>
                    {item.detailItems.map((detail) => <li key={detail}>{detail}</li>)}
                  </ul>
                  <p className="scenario-story-outcome">
                    <span>{language === "zh" ? "交付" : "Output"}</span>
                    {item.outcome}
                  </p>
                </div>
                <figure className="scenario-story-media">
                  <img
                    alt={item.imageAlt}
                    decoding="async"
                    height="540"
                    loading="lazy"
                    src={item.imageSrc}
                    width="960"
                  />
                </figure>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="home-section safety-section" aria-labelledby="safety-title">
        <div className="safety-copy">
          <p className="section-kicker">{content.safety.eyebrow}</p>
          <h2 id="safety-title">{content.safety.title}</h2>
          <p>{content.safety.description}</p>
          <div className="safety-links">
            <a href="/docs/?doc=permissions">{content.safety.docsLabel}</a>
            <a href="/privacy/">{content.safety.privacyLabel}</a>
          </div>
        </div>
        <ol className="safety-list">
          {content.safety.items.map((item, index) => (
            <li key={item.title}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <div>
                <h3>{item.title}</h3>
                <p>{item.description}</p>
              </div>
            </li>
          ))}
        </ol>
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

      <section className="home-section faq-section" aria-labelledby="faq-title">
        <div className="faq-heading">
          <p className="section-kicker">{content.faq.eyebrow}</p>
          <h2 id="faq-title">{content.faq.title}</h2>
        </div>
        <FaqList items={content.faq.items} />
      </section>

      <SiteFooter showCommunity />
    </main>
  )
}
