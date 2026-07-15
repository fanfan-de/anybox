import type { ReactNode } from "react"
import { AtmosphereBackground } from "../AtmosphereBackground"
import { SiteFooter, SiteHeader } from "../SiteChrome"
import { useSiteLanguage } from "../language"

type PolicyLayoutProps = {
  children: ReactNode
  kicker: string
  title: string
  titleId: string
  updated: string
}

export function PolicyLayout({ children, kicker, title, titleId, updated }: PolicyLayoutProps) {
  const { language } = useSiteLanguage()

  return (
    <main className="policy-page-shell">
      <AtmosphereBackground />
      <SiteHeader currentPage="policy" />
      <article className="policy-content" aria-labelledby={titleId}>
        <p className="section-kicker">{kicker}</p>
        <h1 id={titleId}>{title}</h1>
        <p className="policy-updated">
          {language === "zh" ? "最后更新：" : "Last updated: "}
          {updated}
        </p>
        {children}
      </article>
      <SiteFooter />
    </main>
  )
}
