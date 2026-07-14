import { useEffect, useState } from "react"
import { AtmosphereBackground } from "./AtmosphereBackground"
import { siteContent } from "./content"
import { GitActivitySection } from "./GitActivity"
import { InstallerDownloadButton } from "./InstallerDownloadButton"
import { LanguageSwitcher, useSiteLanguage } from "./language"
import { repositoryUrl } from "./releaseDownloads"
import { supportEmail, supportMailto } from "./siteLinks"

const brandLogoBlack = "/brand-logo-black.svg"
const wechatCommunityQrImage = "/wechat-community-qr-20260702.png"
const icpRecordNumber = "苏ICP备2026030016号-1"
const icpRecordUrl = "https://beian.miit.gov.cn/"

function getGitHubRepoApiUrl(href: string) {
  const match = href.match(/^https:\/\/github\.com\/([^/]+)\/([^/#?]+)/)

  if (!match) return undefined

  return `https://api.github.com/repos/${match[1]}/${match[2]}`
}

function formatStarCount(count: number) {
  if (count < 1000) return String(count)
  if (count < 10000) return `${(count / 1000).toFixed(1)}K`

  return `${Math.round(count / 1000)}K`
}

function StarIcon() {
  return (
    <svg
      aria-hidden="true"
      className="nav-star-icon"
      focusable="false"
      viewBox="0 0 24 24"
    >
      <path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2Z" />
    </svg>
  )
}

function GitHubStarCount({ href }: { href: string }) {
  const [starCount, setStarCount] = useState<number | undefined>()

  useEffect(() => {
    const apiUrl = getGitHubRepoApiUrl(href)

    if (!apiUrl) return

    const controller = new AbortController()

    fetch(apiUrl, {
      cache: "no-store",
      headers: {
        Accept: "application/vnd.github+json",
      },
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`GitHub star request failed: ${response.status}`)
        }

        return response.json()
      })
      .then((data: { stargazers_count?: unknown }) => {
        if (typeof data.stargazers_count === "number") {
          setStarCount(data.stargazers_count)
        }
      })
      .catch(() => {})

    return () => {
      controller.abort()
    }
  }, [href])

  if (starCount === undefined) return null

  return (
    <span className="nav-star-count" aria-label={`${starCount} GitHub stars`}>
      <span>[{formatStarCount(starCount)}</span>
      <StarIcon />
      <span>]</span>
    </span>
  )
}

function NavigationLink({
  href,
  label,
  external,
}: {
  href: string
  label: string
  external?: boolean
}) {
  return (
    <a
      className="nav-link"
      href={href}
      rel={external ? "noreferrer" : undefined}
      target={external ? "_blank" : undefined}
    >
      <span>{label}</span>
      {label === "GitHub" ? <GitHubStarCount href={href} /> : null}
    </a>
  )
}

function BrandLockup({ language }: { language: "zh" | "en" }) {
  return (
    <a
      className="brand-lockup"
      href="#top"
      aria-label={language === "zh" ? "Anybox 首页" : "Anybox home"}
    >
      <img src={brandLogoBlack} alt="" />
      <span>Anybox</span>
    </a>
  )
}

function ProofList({ items, label }: { items: string[]; label: string }) {
  return (
    <ul className="proof-list" aria-label={label}>
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  )
}

function ScenarioSection({ language }: { language: "zh" | "en" }) {
  const content = siteContent[language].scenarios

  return (
    <section className="scenario-section" aria-labelledby="scenario-heading">
      <div className="scenario-heading">
        <h2 id="scenario-heading">{content.kicker}</h2>
        <p>{content.description}</p>
      </div>

      <div className="scenario-grid">
        {content.cards.map((card) => (
          <article className="scenario-card" key={card.title}>
            <figure className="scenario-card-media">
              <div className="scenario-card-frame">
                <img src={card.image} alt={card.imageAlt} />
              </div>
            </figure>
            <div className="scenario-card-copy">
              <h3>{card.title}</h3>
              <p>
                <strong>{content.audienceLabel}</strong>
                {card.audience}
              </p>
              <p>
                <strong>{content.capabilityLabel}</strong>
                {card.capability}
              </p>
              <div>
                <strong>{content.tasksLabel}</strong>
                <ul>
                  {card.tasks.map((task) => (
                    <li key={task}>{task}</li>
                  ))}
                </ul>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

function ProductCommunityQr() {
  return (
    <div className="community-qr-block">
      <img className="community-qr-image" src={wechatCommunityQrImage} alt="" />
    </div>
  )
}

function CommunityBottomSection({ language }: { language: "zh" | "en" }) {
  return (
    <section className="community-section" id="product">
      <div className="community-layout">
        <GitActivitySection language={language} />
        <ProductCommunityQr />
      </div>
    </section>
  )
}

function SiteFooter({ language }: { language: "zh" | "en" }) {
  const isChinese = language === "zh"

  return (
    <footer className="site-footer">
      <span>© 2026 Anybox</span>
      <nav
        className="site-footer-links"
        aria-label={isChinese ? "页脚导航" : "Footer navigation"}
      >
        <a href="/pricing/">{isChinese ? "定价" : "Pricing"}</a>
        <a href="/terms/">{isChinese ? "条款" : "Terms"}</a>
        <a href="/privacy/">{isChinese ? "隐私" : "Privacy"}</a>
        <a href="/refunds/">{isChinese ? "退款" : "Refunds"}</a>
        <a href="/acceptable-use/">
          {isChinese ? "使用规范" : "Acceptable Use"}
        </a>
        <a href={supportMailto}>{supportEmail}</a>
        <a href={icpRecordUrl} rel="noreferrer" target="_blank">
          {icpRecordNumber}
        </a>
      </nav>
    </footer>
  )
}

export function App() {
  const { language } = useSiteLanguage()
  const content = siteContent[language]
  const isChinese = language === "zh"

  useEffect(() => {
    document.title = isChinese
      ? "Anybox｜本地 AI Agent 工作台"
      : "Anybox | Local AI agent workspace"
  }, [isChinese])

  return (
    <main className="page-shell" id="top">
      <AtmosphereBackground />
      <header className="site-header">
        <BrandLockup language={language} />
        <nav
          className="site-nav"
          aria-label={isChinese ? "页面导航" : "Page navigation"}
        >
          {content.navigationItems.map((item) => (
            <NavigationLink
              key={item.href}
              href={item.href}
              label={item.label}
              external={"external" in item ? item.external : undefined}
            />
          ))}
        </nav>
        <LanguageSwitcher />
      </header>

      <section className="hero-section" aria-labelledby="hero-title">
        <div className="hero-copy">
          <div className="hero-brand">
            <img className="hero-mark" src={brandLogoBlack} alt="" />
            <h1 id="hero-title">Anybox</h1>
          </div>
          <p>
            {isChinese
              ? "开源、灵活的通用 Agent"
              : "An open-source, flexible general-purpose agent"}
          </p>
          <div className="hero-actions">
            <InstallerDownloadButton
              className="button button-primary"
              platform="windows"
            >
              {isChinese ? "Windows 下载" : "Download for Windows"}
            </InstallerDownloadButton>
            <InstallerDownloadButton
              className="button button-secondary"
              platform="mac"
            >
              {isChinese ? "macOS 下载" : "Download for macOS"}
            </InstallerDownloadButton>
            <InstallerDownloadButton
              className="button button-secondary"
              platform="linux"
            >
              {isChinese ? "Linux 下载" : "Download for Linux"}
            </InstallerDownloadButton>
            <InstallerDownloadButton
              className="button button-secondary"
              platform="mobile"
            >
              {isChinese ? "Android 下载" : "Download for Android"}
            </InstallerDownloadButton>
          </div>
          <p className="hero-platform-note">
            {isChinese
              ? "当前提供 Windows x64、macOS Apple Silicon、Linux x64 与 Android"
              : "Available for Windows x64, macOS Apple Silicon, Linux x64, and Android."}
          </p>
        </div>
      </section>

      <section
        className="proof-section"
        aria-label={isChinese ? "Anybox 产品能力" : "Anybox capabilities"}
      >
        <ProofList
          items={content.proofPoints}
          label={isChinese ? "产品关键信号" : "Product highlights"}
        />
      </section>

      <ScenarioSection language={language} />
      <CommunityBottomSection language={language} />
      <SiteFooter language={language} />
    </main>
  )
}
