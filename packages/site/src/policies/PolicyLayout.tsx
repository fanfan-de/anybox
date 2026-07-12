import type { ReactNode } from "react"
import { AtmosphereBackground } from "../AtmosphereBackground"
import { LanguageSwitcher, useSiteLanguage } from "../language"
import { supportEmail, supportMailto } from "../siteLinks"

const brandLogoBlack = "/brand-logo-black.svg"

type PolicyLayoutProps = {
  children: ReactNode
  kicker: string
  title: string
  titleId: string
  updated: string
}

function PolicyHeader() {
  const { language } = useSiteLanguage()
  const isChinese = language === "zh"

  return (
    <header className="site-header policy-header">
      <a
        className="brand-lockup"
        href="/"
        aria-label={isChinese ? "Anybox 首页" : "Anybox home"}
      >
        <img src={brandLogoBlack} alt="" />
        <span>Anybox</span>
      </a>
      <nav
        className="docs-header-nav"
        aria-label={isChinese ? "政策页导航" : "Policy page navigation"}
      >
        <a href="/">{isChinese ? "首页" : "Home"}</a>
        <a href="/pricing/">{isChinese ? "定价" : "Pricing"}</a>
        <a href="/docs/">{isChinese ? "文档" : "Docs"}</a>
        <a href={supportMailto}>{supportEmail}</a>
      </nav>
      <LanguageSwitcher />
    </header>
  )
}

function PolicyFooter() {
  const { language } = useSiteLanguage()
  const isChinese = language === "zh"

  return (
    <footer className="site-footer policy-footer">
      <span>© 2026 Anybox</span>
      <nav
        className="site-footer-links"
        aria-label={isChinese ? "政策页页脚导航" : "Policy footer navigation"}
      >
        <a href="/terms/">{isChinese ? "服务条款" : "Terms"}</a>
        <a href="/privacy/">{isChinese ? "隐私政策" : "Privacy"}</a>
        <a href="/refunds/">{isChinese ? "退款政策" : "Refunds"}</a>
        <a href="/acceptable-use/">
          {isChinese ? "可接受使用政策" : "Acceptable Use"}
        </a>
        <a href={supportMailto}>{supportEmail}</a>
      </nav>
    </footer>
  )
}

export function PolicyLayout({ children, kicker, title, titleId, updated }: PolicyLayoutProps) {
  const { language } = useSiteLanguage()

  return (
    <main className="policy-page-shell">
      <AtmosphereBackground />
      <PolicyHeader />
      <article className="policy-content" aria-labelledby={titleId}>
        <p className="section-kicker">{kicker}</p>
        <h1 id={titleId}>{title}</h1>
        <p className="policy-updated">
          {language === "zh" ? "最后更新：" : "Last updated: "}
          {updated}
        </p>
        {children}
      </article>
      <PolicyFooter />
    </main>
  )
}
