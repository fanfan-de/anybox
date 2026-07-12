import { PolicyLayout } from "../policies/PolicyLayout"
import { supportEmail, supportMailto } from "../siteLinks"

export function RefundsPage() {
  return (
    <PolicyLayout
      kicker="Refund and Cancellation Policy"
      title="Refunds and cancellations"
      titleId="refunds-title"
      updated="July 12, 2026"
    >
      <section>
        <h2>1. Scope</h2>
        <p>
          This policy applies to paid Anybox Managed AI subscriptions and other
          paid digital services offered by Anybox. The free open-source desktop
          application does not require a purchase and is not covered by this
          refund policy.
        </p>
      </section>

      <section>
        <h2>2. Merchant of Record</h2>
        <p>
          Purchases may be completed through Paddle or another Merchant of Record
          identified at checkout. The Merchant of Record is the seller for the
          transaction and processes payment, taxes, receipts, cancellations, and
          approved refunds under its buyer terms and mandatory consumer law.
          Nothing in this policy limits rights that cannot legally be waived.
        </p>
      </section>

      <section>
        <h2>3. Subscription Cancellation</h2>
        <p>
          You may cancel a subscription at any time before the next renewal using
          the billing portal made available with your purchase or by emailing
          <a href={supportMailto}> {supportEmail}</a>. Cancellation stops future
          renewals and normally takes effect at the end of the current paid
          billing period. Unless a refund is approved, access remains available
          until that period ends.
        </p>
      </section>

      <section>
        <h2>4. Refund Requests</h2>
        <p>
          You may request a refund within 14 days of the initial purchase or a
          subscription renewal. Requests are reviewed individually. We may
          consider service availability, technical defects, the amount of
          managed AI usage already consumed, suspected fraud or refund abuse,
          and applicable law. A request within 14 days does not guarantee a full
          refund unless required by law.
        </p>
        <ul>
          <li>
            A full refund is generally appropriate when the paid service was not
            provisioned, was materially unavailable, or has not been materially
            used.
          </li>
          <li>
            A partial refund or denial may apply when a substantial portion of
            the included managed AI usage has already been consumed.
          </li>
          <li>
            Refunds may be denied for fraud, policy violations, refund abuse, or
            attempts to obtain service without payment.
          </li>
        </ul>
      </section>

      <section>
        <h2>5. Technical Problems</h2>
        <p>
          Contact support first if a persistent technical issue prevents access
          to a material paid feature. We will make a reasonable effort to restore
          access or provide a workaround. If the issue cannot be resolved, we
          will work with the Merchant of Record on an appropriate full or partial
          refund, subject to applicable law.
        </p>
      </section>

      <section>
        <h2>6. How to Request a Refund</h2>
        <p>
          Email <a href={supportMailto}>{supportEmail}</a> from the address used
          for the purchase and include the transaction or receipt identifier,
          purchase date, and reason for the request. You may also use the refund
          or order-support link in the Merchant of Record receipt or billing
          portal. Do not email full card details, passwords, or identity
          documents unless a verified support channel specifically requires
          them.
        </p>
      </section>

      <section>
        <h2>7. Processing and Access</h2>
        <p>
          Approved refunds are returned through the original payment method where
          possible. Processing time depends on the Merchant of Record, payment
          method, and financial institution. Access and unused service
          entitlements associated with a refunded transaction may be revoked when
          the refund is approved.
        </p>
      </section>

      <section>
        <h2>8. Chargebacks</h2>
        <p>
          Please contact Anybox or the Merchant of Record before opening a
          chargeback so we can investigate and attempt to resolve the issue. This
          request does not limit any lawful right to dispute a transaction.
        </p>
      </section>

      <section>
        <h2>9. Policy Changes</h2>
        <p>
          The version presented at purchase applies to that transaction, together
          with mandatory law and the Merchant of Record buyer terms. Material
          changes will be reflected by the updated date at the top of this page.
        </p>
      </section>
    </PolicyLayout>
  )
}
