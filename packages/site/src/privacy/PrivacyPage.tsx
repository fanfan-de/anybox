import { PolicyLayout } from "../policies/PolicyLayout"
import { supportEmail, supportMailto } from "../siteLinks"

export function PrivacyPage() {
  return (
    <PolicyLayout
      kicker="Privacy Policy"
      title="Anybox Privacy Policy"
      titleId="privacy-title"
      updated="July 12, 2026"
    >
      <section>
        <h2>1. Scope</h2>
        <p>
          This Privacy Policy explains how Anybox handles information through
          the public website, the open-source desktop application, the Chrome
          extension, and Anybox Managed AI Provider. The desktop application is
          local-first; the managed service is optional and requires a separate
          account.
        </p>
      </section>

      <section>
        <h2>2. Information We Process</h2>
        <ul>
          <li>
            <strong>Account data:</strong> name, email address, workspace and
            account identifiers, password hashes, verification state, login
            sessions, and OAuth authorization records.
          </li>
          <li>
            <strong>Managed AI request data:</strong> prompts, messages,
            attachments, model selections, and generated responses that you
            choose to send through Anybox Managed AI.
          </li>
          <li>
            <strong>Usage and service data:</strong> model name, token or usage
            counts, request status, latency, error details, service cost,
            subscription entitlement, and transaction status.
          </li>
          <li>
            <strong>Security data:</strong> IP address, request identifiers,
            authentication type, rate-limit events, and administrative audit
            records where needed to secure and operate the service.
          </li>
          <li>
            <strong>Support data:</strong> messages and diagnostic information
            you choose to send when asking for help.
          </li>
        </ul>
      </section>

      <section>
        <h2>3. Managed AI Requests</h2>
        <p>
          Managed AI request content is transmitted to the selected upstream AI
          provider to perform the request. Ordinary usage logs record metadata
          and metering information, not the full request body. To support safe
          idempotent retries, eligible response bodies may be encrypted and
          cached temporarily, normally for up to 24 hours, before the cached
          content is purged.
        </p>
        <p>
          Do not submit secrets, regulated data, or sensitive personal
          information unless it is necessary and you are authorized to do so.
          Upstream providers process request content under their applicable
          terms, privacy commitments, and account settings.
        </p>
      </section>

      <section>
        <h2>4. Desktop Application and Chrome Extension</h2>
        <p>
          The Chrome extension connects Chrome to the locally installed Anybox
          Desktop application. When you use browser automation, it may access
          tabs, page content, screenshots, DOM or accessibility information, and
          user-initiated browser actions. This information is sent to the local
          Anybox agent through Chrome Native Messaging or a localhost
          connection.
        </p>
        <p>
          The extension stores limited local state such as connection status,
          extension instance ID, and transport preferences. Browser content is
          not used for advertising or third-party profiling. Content leaves the
          local device only when a requested feature requires a remote service,
          such as an upstream model or Anybox Managed AI.
        </p>
      </section>

      <section>
        <h2>5. Payments</h2>
        <p>
          Purchases may be processed by a Merchant of Record such as Paddle or
          another provider shown at checkout. The Merchant of Record processes
          payment credentials, taxes, receipts, refunds, and transaction fraud
          checks under its own privacy policy. Anybox receives transaction and
          entitlement information needed to activate and support the service,
          but does not receive full card details.
        </p>
      </section>

      <section>
        <h2>6. How We Use Information</h2>
        <ul>
          <li>Provide authentication, model routing, metering, and support.</li>
          <li>Prevent fraud, abuse, prohibited content, and service attacks.</li>
          <li>Maintain reliability, investigate failures, and improve features.</li>
          <li>Administer subscriptions, entitlements, cancellations, and refunds.</li>
          <li>Comply with legal, tax, payment-network, and provider obligations.</li>
        </ul>
      </section>

      <section>
        <h2>7. Service Providers and International Processing</h2>
        <p>
          We may share information with upstream AI providers, cloud and email
          infrastructure providers, fraud and moderation services, and our
          Merchant of Record, only as needed to provide and secure the service.
          These providers may process information in countries other than your
          own. We may also disclose information when required by law or to
          protect users, Anybox, or the public.
        </p>
      </section>

      <section>
        <h2>8. Retention and Security</h2>
        <p>
          We retain account, transaction, usage, security, and audit records for
          as long as reasonably necessary for service delivery, fraud prevention,
          dispute handling, legal compliance, and legitimate business needs.
          Temporary encrypted response caches use shorter operational retention.
          We use access controls, encryption for sensitive service secrets and
          eligible cached responses, password hashing, rate limits, and audit
          logging. No security measure can guarantee absolute security.
        </p>
      </section>

      <section>
        <h2>9. Your Choices and Rights</h2>
        <p>
          You may remove the extension, stop using Managed AI, revoke connected
          sessions, or request access, correction, or deletion of personal data.
          Some records may be retained where required for tax, fraud, payment,
          security, or legal purposes. Requests are subject to identity
          verification and applicable law.
        </p>
      </section>

      <section>
        <h2>10. Children</h2>
        <p>
          Anybox Managed AI is not directed to children under 18 and should not
          be used by a child without the involvement and consent of a parent or
          legal guardian where permitted by law.
        </p>
      </section>

      <section>
        <h2>11. Changes and Contact</h2>
        <p>
          We may update this policy as the product, providers, or legal
          requirements change. Material updates will be reflected by the date at
          the top of this page. For privacy questions or requests, email
          {" "}
          <a href={supportMailto}>{supportEmail}</a>.
        </p>
      </section>
    </PolicyLayout>
  )
}
