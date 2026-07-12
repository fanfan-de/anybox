import { useEffect } from "react"
import { AtmosphereBackground } from "../AtmosphereBackground"
import { LanguageSwitcher, useSiteLanguage } from "../language"
import { repositoryUrl } from "../releaseDownloads"
import { supportEmail, supportMailto } from "../siteLinks"

const brandLogoBlack = "/brand-logo-black.svg"

type PricingPlan = {
  name: string
  description: string
  price: string
  cadence: string
  features: string[]
  emphasis?: string
  action:
    | { href: string; label: string }
    | { disabled: true; label: string }
}

const pricingCopy = {
  en: {
    home: "Home",
    pricing: "Pricing",
    docs: "Docs",
    privacy: "Privacy",
    terms: "Terms",
    refunds: "Refunds",
    acceptableUse: "Acceptable Use",
    kicker: "Managed AI Pricing",
    title: "Open source on your desktop. Managed AI when you need it.",
    intro:
      "The Anybox desktop workspace is free and open source. Paid monthly plans provide access to Anybox Managed AI, our hosted inference and orchestration service.",
    launchTitle: "Planned launch pricing",
    launchBody:
      "Prices are shown in USD. Paid plans are not available for purchase yet and no payment information is collected on this page.",
    plansLabel: "Anybox plans",
    plans: [
      {
        name: "Free Desktop",
        description: "The open-source Anybox workspace for local AI agents.",
        price: "$0",
        cadence: "forever",
        features: [
          "Open-source desktop application",
          "Local projects and agent workflows",
          "Bring your own provider accounts and API keys",
          "No Anybox Managed AI usage included",
        ],
        action: { href: repositoryUrl, label: "Get Anybox" },
      },
      {
        name: "Individual Monthly",
        description:
          "Managed inference for individual users and independent builders.",
        price: "$10",
        cadence: "per month",
        emphasis: "Planned launch plan",
        features: [
          "Access to Anybox Managed AI Provider",
          "Included monthly managed AI usage",
          "Standard concurrency and model availability",
          "Monthly usage does not roll over",
        ],
        action: { disabled: true, label: "Coming soon" },
      },
      {
        name: "Pro Monthly",
        description:
          "Higher managed usage and capacity for demanding workflows.",
        price: "$30",
        cadence: "per month",
        features: [
          "Everything in Individual Monthly",
          "Higher monthly managed AI usage",
          "Higher concurrency and broader model access",
          "Priority product support",
        ],
        action: { disabled: true, label: "Coming soon" },
      },
    ] satisfies PricingPlan[],
    purchaseKicker: "What customers purchase",
    purchaseTitle: "A managed service, not stored value.",
    purchaseBody:
      "Anybox Managed AI is operated by Anybox. Customers purchase access to the managed service and its monthly usage allowance. Usage is non-transferable, has no cash value, and cannot be used to purchase third-party goods or services.",
    faqKicker: "FAQ",
    faqTitle: "Before paid plans launch",
    faq: [
      {
        question: "What does a paid plan provide?",
        answer:
          "A paid plan provides access to Anybox Managed AI Provider, a hosted inference and orchestration service operated and supported by Anybox.",
      },
      {
        question: "Do customers receive third-party API keys or accounts?",
        answer:
          "No. Customers access the Anybox managed service. We do not deliver upstream provider accounts, API keys, gift cards, coupons, or raw third-party credits.",
      },
      {
        question: "Are monthly usage allowances stored value?",
        answer:
          "No. Monthly usage is a non-transferable service entitlement that can only be used within Anybox Managed AI. It cannot be withdrawn, exchanged for cash, or used as payment.",
      },
      {
        question: "Can I purchase one-time usage packs?",
        answer:
          "Not at launch. Anybox plans to start with fixed monthly subscriptions and will only add one-time usage packs after written approval from its Merchant of Record.",
      },
    ],
  },
  zh: {
    home: "首页",
    pricing: "定价",
    docs: "文档",
    privacy: "隐私",
    terms: "条款",
    refunds: "退款",
    acceptableUse: "使用规范",
    kicker: "托管 AI 定价",
    title: "桌面端保持开源，需要时再使用托管 AI。",
    intro:
      "Anybox 桌面工作台永久免费开源。付费月度方案提供 Anybox Managed AI——由我们运营的托管推理与编排服务。",
    launchTitle: "计划中的首发定价",
    launchBody:
      "价格以美元显示。付费方案尚未开放购买，本页面目前不会收集任何付款信息。",
    plansLabel: "Anybox 方案",
    plans: [
      {
        name: "免费桌面版",
        description: "面向本地 AI Agent 的开源 Anybox 工作台。",
        price: "$0",
        cadence: "永久免费",
        features: [
          "开源桌面应用",
          "本地项目与 Agent 工作流",
          "使用你自己的模型供应商账户和 API Key",
          "不包含 Anybox Managed AI 用量",
        ],
        action: { href: repositoryUrl, label: "获取 Anybox" },
      },
      {
        name: "个人月度版",
        description: "适合个人用户和独立开发者的托管推理服务。",
        price: "$10",
        cadence: "每月",
        emphasis: "计划首发方案",
        features: [
          "访问 Anybox Managed AI Provider",
          "包含每月托管 AI 用量",
          "标准并发与模型可用范围",
          "月度用量不会结转",
        ],
        action: { disabled: true, label: "即将推出" },
      },
      {
        name: "专业月度版",
        description: "为高强度工作流提供更高用量和容量。",
        price: "$30",
        cadence: "每月",
        features: [
          "包含个人月度版全部功能",
          "更高的月度托管 AI 用量",
          "更高并发和更多模型选择",
          "优先产品支持",
        ],
        action: { disabled: true, label: "即将推出" },
      },
    ] satisfies PricingPlan[],
    purchaseKicker: "客户购买的内容",
    purchaseTitle: "购买的是托管服务，而不是储值。",
    purchaseBody:
      "Anybox Managed AI 由 Anybox 运营。客户购买的是托管服务访问权和对应的月度用量。用量不可转让、没有现金价值，也不能用于购买第三方商品或服务。",
    faqKicker: "常见问题",
    faqTitle: "付费方案上线之前",
    faq: [
      {
        question: "付费方案提供什么？",
        answer:
          "付费方案提供 Anybox Managed AI Provider 的访问权。这是由 Anybox 运营和支持的托管推理与编排服务。",
      },
      {
        question: "客户会收到第三方 API Key 或账户吗？",
        answer:
          "不会。客户访问的是 Anybox 托管服务。我们不会交付上游供应商账户、API Key、礼品卡、优惠券或原始第三方额度。",
      },
      {
        question: "月度用量属于储值吗？",
        answer:
          "不属于。月度用量是不可转让的服务权益，只能在 Anybox Managed AI 内使用，不能提取、兑换现金或作为支付工具。",
      },
      {
        question: "可以购买一次性用量包吗？",
        answer:
          "首发阶段不提供。Anybox 计划先采用固定月度订阅，只有在获得 Merchant of Record 书面批准后才会增加一次性用量包。",
      },
    ],
  },
}

function PricingHeader() {
  const { language } = useSiteLanguage()
  const copy = pricingCopy[language]

  return (
    <header className="site-header pricing-header">
      <a className="brand-lockup" href="/" aria-label={`${copy.home} Anybox`}>
        <img src={brandLogoBlack} alt="" />
        <span>Anybox</span>
      </a>
      <nav className="docs-header-nav" aria-label={copy.pricing}>
        <a href="/">{copy.home}</a>
        <a href="/pricing/" aria-current="page">{copy.pricing}</a>
        <a href="/docs/">{copy.docs}</a>
        <a href="/privacy/">{copy.privacy}</a>
        <a href={supportMailto}>{supportEmail}</a>
      </nav>
      <LanguageSwitcher />
    </header>
  )
}

function PlanAction({ action }: { action: PricingPlan["action"] }) {
  if ("disabled" in action) {
    return (
      <button className="button button-secondary pricing-plan-action" disabled>
        {action.label}
      </button>
    )
  }

  return (
    <a
      className="button button-primary pricing-plan-action"
      href={action.href}
      rel="noreferrer"
      target="_blank"
    >
      {action.label}
    </a>
  )
}

function PricingFooter() {
  const { language } = useSiteLanguage()
  const copy = pricingCopy[language]

  return (
    <footer className="site-footer pricing-footer">
      <span>© 2026 Anybox</span>
      <nav className="site-footer-links" aria-label={copy.pricing}>
        <a href="/">{copy.home}</a>
        <a href="/docs/">{copy.docs}</a>
        <a href="/terms/">{copy.terms}</a>
        <a href="/privacy/">{copy.privacy}</a>
        <a href="/refunds/">{copy.refunds}</a>
        <a href="/acceptable-use/">{copy.acceptableUse}</a>
        <a href={supportMailto}>{supportEmail}</a>
      </nav>
    </footer>
  )
}

export function PricingPage() {
  const { language } = useSiteLanguage()
  const copy = pricingCopy[language]

  useEffect(() => {
    document.title = language === "zh" ? "Anybox 定价" : "Anybox Pricing"
  }, [language])

  return (
    <main className="pricing-page-shell">
      <AtmosphereBackground />
      <PricingHeader />

      <div className="pricing-content">
        <header className="pricing-hero">
          <p className="section-kicker">{copy.kicker}</p>
          <h1>{copy.title}</h1>
          <p>{copy.intro}</p>
        </header>

        <aside className="pricing-launch-note" aria-label={copy.launchTitle}>
          <strong>{copy.launchTitle}</strong>
          <span>{copy.launchBody}</span>
        </aside>

        <section className="pricing-grid" aria-label={copy.plansLabel}>
          {copy.plans.map((plan) => (
            <article className="pricing-plan" key={plan.name}>
              <div className="pricing-plan-heading">
                {plan.emphasis ? (
                  <p className="pricing-plan-label">{plan.emphasis}</p>
                ) : null}
                <h2>{plan.name}</h2>
                <p>{plan.description}</p>
              </div>
              <p className="pricing-plan-price">
                <strong>{plan.price}</strong>
                <span>{plan.cadence}</span>
              </p>
              <ul className="pricing-plan-features">
                {plan.features.map((feature) => <li key={feature}>{feature}</li>)}
              </ul>
              <PlanAction action={plan.action} />
            </article>
          ))}
        </section>

        <section className="pricing-service-note" aria-labelledby="service-note-title">
          <p className="section-kicker">{copy.purchaseKicker}</p>
          <h2 id="service-note-title">{copy.purchaseTitle}</h2>
          <p>{copy.purchaseBody}</p>
        </section>

        <section className="pricing-faq" aria-labelledby="pricing-faq-title">
          <div className="pricing-faq-heading">
            <p className="section-kicker">{copy.faqKicker}</p>
            <h2 id="pricing-faq-title">{copy.faqTitle}</h2>
          </div>
          <div className="pricing-faq-list">
            {copy.faq.map((item) => (
              <article key={item.question}>
                <h3>{item.question}</h3>
                <p>{item.answer}</p>
              </article>
            ))}
          </div>
        </section>
      </div>

      <PricingFooter />
    </main>
  )
}
