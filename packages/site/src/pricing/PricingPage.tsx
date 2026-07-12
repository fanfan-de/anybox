import { AtmosphereBackground } from "../AtmosphereBackground"
import { repositoryUrl } from "../releaseDownloads"

const brandLogoBlack = "/brand-logo-black.svg"
const supportUrl = "https://github.com/fanfan-de/anybox/issues"

type PricingPlan = {
  name: string
  description: string
  price: string
  cadence: string
  features: string[]
  emphasis?: string
  action:
    | {
        href: string
        label: string
      }
    | {
        disabled: true
        label: string
      }
}

const pricingPlans: PricingPlan[] = [
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
    action: {
      href: repositoryUrl,
      label: "Get Anybox",
    },
  },
  {
    name: "Individual Monthly",
    description: "Managed inference for individual users and independent builders.",
    price: "$10",
    cadence: "per month",
    emphasis: "Planned launch plan",
    features: [
      "Access to Anybox Managed AI Provider",
      "Included monthly managed AI usage",
      "Standard concurrency and model availability",
      "Monthly usage does not roll over",
    ],
    action: {
      disabled: true,
      label: "Coming soon",
    },
  },
  {
    name: "Pro Monthly",
    description: "Higher managed usage and capacity for demanding workflows.",
    price: "$30",
    cadence: "per month",
    features: [
      "Everything in Individual Monthly",
      "Higher monthly managed AI usage",
      "Higher concurrency and broader model access",
      "Priority product support",
    ],
    action: {
      disabled: true,
      label: "Coming soon",
    },
  },
]

const pricingFaq = [
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
]

function PricingHeader() {
  return (
    <header className="site-header pricing-header">
      <a className="brand-lockup" href="/" aria-label="Anybox home">
        <img src={brandLogoBlack} alt="" />
        <span>Anybox</span>
      </a>
      <nav className="docs-header-nav" aria-label="Pricing page navigation">
        <a href="/">Home</a>
        <a href="/pricing/" aria-current="page">
          Pricing
        </a>
        <a href="/docs/">Docs</a>
        <a href="/privacy/">Privacy</a>
        <a href={supportUrl} rel="noreferrer" target="_blank">
          Support
        </a>
      </nav>
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
  return (
    <footer className="site-footer pricing-footer">
      <span>© 2026 Anybox</span>
      <nav className="site-footer-links" aria-label="Pricing footer navigation">
        <a href="/">Home</a>
        <a href="/docs/">Docs</a>
        <a href="/privacy/">Privacy</a>
        <a href={supportUrl} rel="noreferrer" target="_blank">
          Support
        </a>
      </nav>
    </footer>
  )
}

export function PricingPage() {
  return (
    <main className="pricing-page-shell">
      <AtmosphereBackground />
      <PricingHeader />

      <div className="pricing-content">
        <header className="pricing-hero">
          <p className="section-kicker">Managed AI Pricing</p>
          <h1>Open source on your desktop. Managed AI when you need it.</h1>
          <p>
            The Anybox desktop workspace is free and open source. Paid monthly
            plans provide access to Anybox Managed AI, our hosted inference and
            orchestration service.
          </p>
        </header>

        <aside className="pricing-launch-note" aria-label="Launch availability">
          <strong>Planned launch pricing</strong>
          <span>
            Prices are shown in USD. Paid plans are not available for purchase
            yet and no payment information is collected on this page.
          </span>
        </aside>

        <section className="pricing-grid" aria-label="Anybox plans">
          {pricingPlans.map((plan) => (
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
                {plan.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>

              <PlanAction action={plan.action} />
            </article>
          ))}
        </section>

        <section className="pricing-service-note" aria-labelledby="service-note-title">
          <p className="section-kicker">What customers purchase</p>
          <h2 id="service-note-title">A managed service, not stored value.</h2>
          <p>
            Anybox Managed AI is operated by Anybox. Customers purchase access
            to the managed service and its monthly usage allowance. Usage is
            non-transferable, has no cash value, and cannot be used to purchase
            third-party goods or services.
          </p>
        </section>

        <section className="pricing-faq" aria-labelledby="pricing-faq-title">
          <div className="pricing-faq-heading">
            <p className="section-kicker">FAQ</p>
            <h2 id="pricing-faq-title">Before paid plans launch</h2>
          </div>
          <div className="pricing-faq-list">
            {pricingFaq.map((item) => (
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
