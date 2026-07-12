import { PolicyLayout } from "../policies/PolicyLayout"
import { supportEmail, supportMailto } from "../siteLinks"

export function TermsPage() {
  return (
    <PolicyLayout
      kicker="Terms of Service"
      title="Anybox Terms of Service"
      titleId="terms-title"
      updated="July 12, 2026"
    >
      <section>
        <h2>1. Agreement</h2>
        <p>
          These Terms of Service govern your use of the Anybox website,
          open-source desktop application, Chrome extension, and Anybox Managed
          AI Provider. By creating an account, purchasing a plan, or using a
          hosted service, you agree to these Terms and the
          {" "}
          <a href="/acceptable-use/">Acceptable Use Policy</a>. If you do not
          agree, do not use the hosted service.
        </p>
      </section>

      <section>
        <h2>2. The Anybox Products</h2>
        <p>
          The Anybox desktop application is free and open source and is governed
          by the licenses included with its source code. Anybox Managed AI is a
          separate hosted inference and orchestration service operated and
          supported by Anybox. It provides authentication, model routing,
          metering, rate limits, reliability controls, abuse prevention, and
          support.
        </p>
        <p>
          Anybox is an independent product. References to third-party AI models
          describe integrations and do not imply affiliation with or endorsement
          by the model creators.
        </p>
      </section>

      <section>
        <h2>3. Accounts and Eligibility</h2>
        <p>
          You must provide accurate information, keep your credentials secure,
          and promptly notify us of unauthorized access. You are responsible for
          activity under your account. You must be at least 18 years old or the
          age of legal majority where you live. We may require email verification
          or additional checks to prevent fraud and abuse.
        </p>
      </section>

      <section>
        <h2>4. Paid Plans and Monthly Usage</h2>
        <p>
          Paid plans provide access to Anybox Managed AI and an included monthly
          service usage allowance. The allowance is a non-transferable service
          entitlement. It is not money, stored value, a gift card, or a payment
          instrument; it cannot be withdrawn, transferred, exchanged for cash,
          or used to purchase third-party goods or services. Unused monthly
          allowance expires at the end of the applicable billing period and does
          not roll over unless the plan expressly says otherwise.
        </p>
        <p>
          We do not sell or deliver upstream provider accounts, API keys, gift
          cards, coupons, or raw third-party credits. Model availability, rate
          limits, concurrency, and usage allowances may differ by plan and may
          change as described on the pricing page or in a notice to affected
          subscribers.
        </p>
      </section>

      <section>
        <h2>5. Orders, Billing, and Merchant of Record</h2>
        <p>
          Prices, billing frequency, renewal terms, and applicable taxes are
          shown before purchase. When Paddle is shown at checkout, Paddle.com
          acts as our online reseller and Merchant of Record, processes the
          order, and handles payment-related buyer support and returns. Another
          Merchant of Record may be used if identified at checkout.
        </p>
        <p>
          Subscriptions renew automatically until canceled. You authorize the
          Merchant of Record to charge the selected payment method for each
          renewal. You can cancel before the next renewal through the available
          billing portal or by contacting support. Cancellation and refund rules
          are described in the
          {" "}
          <a href="/refunds/">Refund and Cancellation Policy</a>.
        </p>
      </section>

      <section>
        <h2>6. Acceptable Use and AI Content</h2>
        <p>
          You must comply with the
          {" "}
          <a href="/acceptable-use/">Acceptable Use Policy</a>, applicable law,
          and upstream provider requirements. You may not use Anybox for illegal,
          fraudulent, abusive, infringing, sexually explicit, NSFW, or harmful
          content generation. Face swaps, deceptive deepfakes, non-consensual
          intimate content, sexual content involving minors, malware, credential
          theft, and attempts to bypass safety controls are prohibited.
        </p>
        <p>
          We may apply automated moderation, rate limits, investigation,
          suspension, or termination. You remain responsible for your prompts,
          uploaded content, tool actions, generated outputs, and how you use or
          publish them.
        </p>
      </section>

      <section>
        <h2>7. Third-Party Services and Outputs</h2>
        <p>
          Anybox may route requests to third-party AI, cloud, payment, email,
          moderation, or integration providers. Their services may be changed,
          interrupted, or subject to separate terms. AI output may be inaccurate,
          incomplete, offensive, or non-unique and must be independently reviewed
          before important use. Do not rely on output as professional legal,
          medical, financial, or other regulated advice.
        </p>
      </section>

      <section>
        <h2>8. Intellectual Property</h2>
        <p>
          Anybox retains rights in its hosted service, branding, website, and
          non-open-source materials. Open-source components remain governed by
          their respective licenses. You retain rights you lawfully hold in your
          inputs and outputs, subject to applicable law, third-party rights, and
          model-provider terms. You grant us the limited rights needed to process
          content and provide the requested service.
        </p>
      </section>

      <section>
        <h2>9. Suspension and Termination</h2>
        <p>
          We may restrict or suspend access when reasonably necessary to address
          security threats, fraud, payment failure, illegal activity, policy
          violations, provider requirements, or material risk to users or the
          service. We may terminate repeated or serious violations. Where
          practical and lawful, we will provide notice and an opportunity to
          contact support.
        </p>
      </section>

      <section>
        <h2>10. Disclaimers</h2>
        <p>
          To the maximum extent permitted by law, the services are provided "as
          is" and "as available." We do not guarantee uninterrupted access,
          specific model availability, error-free output, or that AI output will
          meet your requirements. Mandatory consumer rights are not excluded.
        </p>
      </section>

      <section>
        <h2>11. Limitation of Liability</h2>
        <p>
          To the maximum extent permitted by law, Anybox is not liable for
          indirect, incidental, special, consequential, or punitive damages, or
          loss of profits, data, goodwill, or business opportunity. Any aggregate
          liability relating to a paid service will not exceed the amount you
          paid for that service during the twelve months before the event giving
          rise to the claim. This limitation does not apply where prohibited by
          law.
        </p>
      </section>

      <section>
        <h2>12. Changes</h2>
        <p>
          We may update these Terms to reflect product, provider, payment, legal,
          or security changes. The updated date will be shown at the top. If a
          material change affects an active paid subscription, we will provide
          reasonable notice where required.
        </p>
      </section>

      <section>
        <h2>13. Contact</h2>
        <p>
          Questions, complaints, cancellation requests, or legal notices may be
          sent to <a href={supportMailto}>{supportEmail}</a>. We aim to respond to
          support requests within three business days.
        </p>
      </section>
    </PolicyLayout>
  )
}
