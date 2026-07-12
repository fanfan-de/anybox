import { useEffect } from "react"
import { useSiteLanguage } from "../language"
import { PolicyLayout } from "../policies/PolicyLayout"
import { supportEmail, supportMailto } from "../siteLinks"

export function RefundsPage() {
  const { language } = useSiteLanguage()

  useEffect(() => {
    document.title = language === "zh" ? "Anybox 退款与取消政策" : "Anybox Refund and Cancellation Policy"
  }, [language])

  if (language === "zh") {
    return (
      <PolicyLayout
        kicker="退款与取消政策"
        title="退款与取消"
        titleId="refunds-title"
        updated="2026 年 7 月 12 日"
      >
        <section>
          <h2>1. 适用范围</h2>
          <p>
            本政策适用于 Anybox Managed AI 付费订阅及 Anybox 提供的其他付费数字服务。
            免费开源桌面应用无需购买，不适用本退款政策。
          </p>
        </section>
        <section>
          <h2>2. Merchant of Record</h2>
          <p>
            购买可能通过 Paddle 或结账时标明的其他 Merchant of Record 完成。
            Merchant of Record 是该交易的销售方，并按其买家条款和强制性消费者法律处理
            付款、税费、收据、取消及获批退款。本政策不限制依法不能放弃的权利。
          </p>
        </section>
        <section>
          <h2>3. 取消订阅</h2>
          <p>
            你可以在下一次续订前，随时通过购买时提供的账单门户，或发送邮件至
            <a href={supportMailto}>{supportEmail}</a> 取消订阅。取消会停止未来续订，通常在
            当前已付费计费周期结束时生效。除非退款获批，服务访问权会保留至该周期结束。
          </p>
        </section>
        <section>
          <h2>4. 退款申请</h2>
          <p>
            你可以在首次购买或订阅续费后的 14 天内申请退款。申请会逐一审核。我们可能
            考虑服务可用性、技术缺陷、已使用的托管 AI 用量、疑似欺诈或退款滥用及适用法律。
            除非法律要求，在 14 天内提出申请并不保证获得全额退款。
          </p>
          <ul>
            <li>付费服务未开通、实质上不可用或尚未被实质使用时，通常适合全额退款。</li>
            <li>包含的托管 AI 用量已被大量使用时，可能只提供部分退款或拒绝退款。</li>
            <li>存在欺诈、政策违规、退款滥用或试图无偿获取服务时，可能拒绝退款。</li>
          </ul>
        </section>
        <section>
          <h2>5. 技术问题</h2>
          <p>
            如果持续的技术问题导致你无法使用重要付费功能，请先联系支持。我们会合理努力
            恢复访问或提供替代方案。如果问题无法解决，我们会与 Merchant of Record 协作，
            在适用法律约束下提供适当的全额或部分退款。
          </p>
        </section>
        <section>
          <h2>6. 如何申请退款</h2>
          <p>
            请使用购买时的邮箱发送邮件至<a href={supportMailto}>{supportEmail}</a>，并提供
            交易或收据编号、购买日期和申请原因。你也可以使用 Merchant of Record 收据或
            账单门户中的退款或订单支持链接。除非经过验证的支持渠道明确要求，请勿通过邮件
            发送完整银行卡信息、密码或身份证件。
          </p>
        </section>
        <section>
          <h2>7. 处理与访问权</h2>
          <p>
            获批退款会在可行时原路退回。处理时间取决于 Merchant of Record、付款方式和
            金融机构。退款获批后，与该交易关联的访问权和未使用服务权益可能被撤销。
          </p>
        </section>
        <section>
          <h2>8. 拒付</h2>
          <p>
            发起拒付前，请先联系 Anybox 或 Merchant of Record，以便我们调查并尝试解决问题。
            这一请求不会限制你依法对交易提出争议的权利。
          </p>
        </section>
        <section>
          <h2>9. 政策变更</h2>
          <p>
            购买时展示的政策版本与强制性法律及 Merchant of Record 买家条款共同适用于该交易。
            重大变更会通过页面顶部的更新日期体现。
          </p>
        </section>
      </PolicyLayout>
    )
  }

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
