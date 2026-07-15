import { useEffect, useId, useState } from "react"
import { LanguageSwitcher, useSiteLanguage } from "./language"
import { repositoryUrl } from "./releaseDownloads"
import { supportEmail, supportMailto } from "./siteLinks"
import { trackSiteEvent } from "./siteAnalytics"

const brandLogoBlack = "/brand-logo-black.svg"
const brandLogoWhite = "/brand-logo-white.svg"
const releasesUrl = `${repositoryUrl}/releases/latest`
const wechatCommunityQrImage = "/wechat-community-qr-20260702.png"
const icpRecordNumber = "苏ICP备2026030016号-1"
const icpRecordUrl = "https://beian.miit.gov.cn/"

export type SitePage = "home" | "docs" | "pricing" | "policy"

type NavigationItem = {
  destination?: "docs" | "github" | "pricing" | "releases"
  external?: boolean
  href: string
  label: string
  page?: SitePage
}

function getNavigationItems(page: SitePage, isChinese: boolean): NavigationItem[] {
  const homeItems: NavigationItem[] = [
    { href: "#product", label: isChinese ? "产品" : "Product" },
    { href: "#workflow", label: isChinese ? "工作方式" : "Workflow" },
  ]

  return [
    ...(page === "home"
      ? homeItems
      : [{ href: "/", label: isChinese ? "首页" : "Home", page: "home" as const }]),
    {
      destination: "docs",
      href: "/docs/",
      label: isChinese ? "文档" : "Docs",
      page: "docs",
    },
    {
      destination: "pricing",
      href: "/pricing/",
      label: isChinese ? "定价" : "Pricing",
      page: "pricing",
    },
    {
      destination: "github",
      external: true,
      href: repositoryUrl,
      label: "GitHub",
    },
    {
      destination: "releases",
      external: true,
      href: releasesUrl,
      label: "Releases",
    },
  ]
}

export function SiteHeader({ currentPage }: { currentPage: SitePage }) {
  const { language } = useSiteLanguage()
  const isChinese = language === "zh"
  const menuId = useId()
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const navigationItems = getNavigationItems(currentPage, isChinese)

  useEffect(() => {
    if (!isMenuOpen) return

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsMenuOpen(false)
    }

    window.addEventListener("keydown", closeOnEscape)
    return () => window.removeEventListener("keydown", closeOnEscape)
  }, [isMenuOpen])

  return (
    <header className={currentPage === "home" ? "site-header is-home" : "site-header"}>
      <a
        className="brand-lockup"
        href={currentPage === "home" ? "#top" : "/"}
        aria-label={isChinese ? "Anybox 首页" : "Anybox home"}
      >
        <img src={currentPage === "home" ? brandLogoWhite : brandLogoBlack} alt="" width="34" height="34" />
        <span>Anybox</span>
      </a>

      <nav
        className={isMenuOpen ? "site-nav is-open" : "site-nav"}
        id={menuId}
        aria-label={isChinese ? "站点导航" : "Site navigation"}
      >
        {navigationItems.map((item) => (
          <a
            aria-current={item.page === currentPage ? "page" : undefined}
            className="nav-link"
            href={item.href}
            key={item.href}
            rel={item.external ? "noreferrer" : undefined}
            target={item.external ? "_blank" : undefined}
            onClick={() => {
              setIsMenuOpen(false)
              if (item.destination) {
                trackSiteEvent({
                  destination: item.destination,
                  language,
                  name: "navigation_click",
                  placement: "header",
                })
              }
            }}
          >
            {item.label}
          </a>
        ))}
      </nav>

      <div className="site-header-actions">
        <LanguageSwitcher />
        <button
          aria-controls={menuId}
          aria-expanded={isMenuOpen}
          className="site-menu-trigger"
          onClick={() => setIsMenuOpen((open) => !open)}
          type="button"
        >
          {isMenuOpen
            ? isChinese ? "关闭" : "Close"
            : isChinese ? "菜单" : "Menu"}
        </button>
      </div>
    </header>
  )
}

export function SiteFooter({ showCommunity = false }: { showCommunity?: boolean }) {
  const { language } = useSiteLanguage()
  const isChinese = language === "zh"

  return (
    <footer className="site-footer">
      {showCommunity ? (
        <div className="footer-community">
          <div className="footer-community-copy">
            <p className="section-kicker">{isChinese ? "社区" : "Community"}</p>
            <h2>{isChinese ? "与 Anybox 用户一起交流" : "Talk with other Anybox users"}</h2>
            <p>
              {isChinese
                ? "扫码加入微信交流群，获取版本动态并分享真实工作流。二维码仅用于加入社群。"
                : "Scan with WeChat for release updates and practical workflow discussions. The code is only used to join the community."}
            </p>
          </div>
          <img
            className="footer-community-qr"
            src={wechatCommunityQrImage}
            alt={isChinese ? "Anybox 微信交流群二维码" : "QR code for the Anybox WeChat community"}
            width="396"
            height="396"
            loading="lazy"
          />
        </div>
      ) : null}

      <div className="site-footer-main">
        <span>© 2026 Anybox</span>
        <nav
          className="site-footer-links"
          aria-label={isChinese ? "页脚导航" : "Footer navigation"}
        >
          <a href="/docs/">{isChinese ? "文档" : "Docs"}</a>
          <a href="/pricing/">{isChinese ? "定价" : "Pricing"}</a>
          <a href="/terms/">{isChinese ? "条款" : "Terms"}</a>
          <a href="/privacy/">{isChinese ? "隐私" : "Privacy"}</a>
          <a href="/refunds/">{isChinese ? "退款" : "Refunds"}</a>
          <a href="/acceptable-use/">{isChinese ? "使用规范" : "Acceptable Use"}</a>
          <a href={supportMailto}>{supportEmail}</a>
          <a href={icpRecordUrl} rel="noreferrer" target="_blank">
            {icpRecordNumber}
          </a>
        </nav>
      </div>
    </footer>
  )
}
