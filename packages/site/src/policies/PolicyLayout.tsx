import type { ReactNode } from "react"
import { AtmosphereBackground } from "../AtmosphereBackground"
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
  return (
    <header className="site-header policy-header">
      <a className="brand-lockup" href="/" aria-label="Anybox home">
        <img src={brandLogoBlack} alt="" />
        <span>Anybox</span>
      </a>
      <nav className="docs-header-nav" aria-label="Policy page navigation">
        <a href="/">Home</a>
        <a href="/pricing/">Pricing</a>
        <a href="/docs/">Docs</a>
        <a href={supportMailto}>{supportEmail}</a>
      </nav>
    </header>
  )
}

function PolicyFooter() {
  return (
    <footer className="site-footer policy-footer">
      <span>© 2026 Anybox</span>
      <nav className="site-footer-links" aria-label="Policy footer navigation">
        <a href="/terms/">Terms</a>
        <a href="/privacy/">Privacy</a>
        <a href="/refunds/">Refunds</a>
        <a href="/acceptable-use/">Acceptable Use</a>
        <a href={supportMailto}>{supportEmail}</a>
      </nav>
    </footer>
  )
}

export function PolicyLayout({ children, kicker, title, titleId, updated }: PolicyLayoutProps) {
  return (
    <main className="policy-page-shell">
      <AtmosphereBackground />
      <PolicyHeader />
      <article className="policy-content" aria-labelledby={titleId}>
        <p className="section-kicker">{kicker}</p>
        <h1 id={titleId}>{title}</h1>
        <p className="policy-updated">Last updated: {updated}</p>
        {children}
      </article>
      <PolicyFooter />
    </main>
  )
}
