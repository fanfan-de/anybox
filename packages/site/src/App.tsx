import { useEffect, useState } from "react"
import { AtmosphereBackground } from "./AtmosphereBackground"
import { navigationItems, proofPoints, scenarioCards } from "./content"
import { GitActivitySection } from "./GitActivity"
import { InstallerDownloadButton } from "./InstallerDownloadButton"
import { repositoryUrl } from "./releaseDownloads"

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

function BrandLockup() {
  return (
    <a className="brand-lockup" href="#top" aria-label="Anybox 首页">
      <img src={brandLogoBlack} alt="" />
      <span>Anybox</span>
    </a>
  )
}

function ProofList() {
  return (
    <ul className="proof-list" aria-label="产品关键信号">
      {proofPoints.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  )
}

function ScenarioSection() {
  return (
    <section className="scenario-section" aria-labelledby="scenario-heading">
      <div className="scenario-heading">
        <h2 id="scenario-heading">AnyBox for anything。</h2>
        <p>从代码到办公，再到创造，把 Anybox 放进你的真实工作现场。</p>
      </div>

      <div className="scenario-grid">
        {scenarioCards.map((card) => (
          <article className="scenario-card" key={card.title}>
            <figure className="scenario-card-media">
              <div className="scenario-card-frame">
                <img src={card.image} alt={card.imageAlt} />
              </div>
            </figure>
            <div className="scenario-card-copy">
              <h3>{card.title}</h3>
              <p>
                <strong>推荐用户：</strong>
                {card.audience}
              </p>
              <p>
                <strong>能力描述：</strong>
                {card.capability}
              </p>
              <div>
                <strong>典型任务：</strong>
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

function CommunityBottomSection() {
  return (
    <section className="community-section" id="product">
      <div className="community-layout">
        <GitActivitySection />
        <ProductCommunityQr />
      </div>
    </section>
  )
}

function SiteFooter() {
  return (
    <footer className="site-footer">
      <span>© 2026 Anybox</span>
      <a href={icpRecordUrl} rel="noreferrer" target="_blank">
        {icpRecordNumber}
      </a>
    </footer>
  )
}

export function App() {
  return (
    <main className="page-shell" id="top">
      <AtmosphereBackground />
      <header className="site-header">
        <BrandLockup />
        <nav className="site-nav" aria-label="页面导航">
          {navigationItems.map((item) => (
            <NavigationLink
              key={item.href}
              href={item.href}
              label={item.label}
              external={"external" in item ? item.external : undefined}
            />
          ))}
        </nav>
      </header>

      <section className="hero-section" aria-labelledby="hero-title">
        <div className="hero-copy">
          <div className="hero-brand">
            <img className="hero-mark" src={brandLogoBlack} alt="" />
            <h1 id="hero-title">Anybox</h1>
          </div>
          <p>开源，灵活的通用agent</p>
          <div className="hero-actions">
            <InstallerDownloadButton
              className="button button-primary"
              platform="windows"
            >
              Windows 下载
            </InstallerDownloadButton>
            <InstallerDownloadButton
              className="button button-secondary"
              platform="mac"
            >
              macOS 下载
            </InstallerDownloadButton>
            <InstallerDownloadButton
              className="button button-secondary"
              platform="mobile"
            >
              Android 下载
            </InstallerDownloadButton>
          </div>
          <p className="hero-platform-note">
            当前提供 Windows x64、macOS Apple Silicon 与 Android；Linux 版本开发中
          </p>
        </div>
      </section>

      <section className="proof-section" aria-label="Anybox 产品能力">
        <ProofList />
      </section>

      <ScenarioSection />
      <CommunityBottomSection />
      <SiteFooter />
    </main>
  )
}
