import { useEffect } from "react"
import { useSiteLanguage } from "../language"
import { PolicyLayout } from "../policies/PolicyLayout"
import { supportEmail, supportMailto } from "../siteLinks"

export function TermsPage() {
  const { language } = useSiteLanguage()

  useEffect(() => {
    document.title = language === "zh" ? "Anybox 服务条款" : "Anybox Terms of Service"
  }, [language])

  if (language === "zh") {
    return (
      <PolicyLayout
        kicker="服务条款"
        title="Anybox 服务条款"
        titleId="terms-title"
        updated="2026 年 7 月 12 日"
      >
        <section>
          <h2>1. 接受条款</h2>
          <p>
            本服务条款适用于你对 Anybox 网站、开源桌面应用、Chrome 扩展和
            Anybox Managed AI Provider 的使用。创建账户、购买方案或使用托管服务，
            即表示你同意本条款及<a href="/acceptable-use/">可接受使用政策</a>。
            如不同意，请勿使用托管服务。
          </p>
        </section>
        <section>
          <h2>2. Anybox 产品</h2>
          <p>
            Anybox 桌面应用永久免费开源，并受源代码中附带许可证的约束。
            Anybox Managed AI 是由 Anybox 运营和支持的独立托管推理与编排服务，
            提供身份验证、模型路由、用量计量、速率限制、可靠性控制、滥用防护和支持。
          </p>
          <p>
            Anybox 是独立产品。对第三方 AI 模型的引用仅表示集成关系，不代表模型创建者
            与 Anybox 存在关联或为 Anybox 背书。
          </p>
        </section>
        <section>
          <h2>3. 账户与资格</h2>
          <p>
            你必须提供准确信息、妥善保管凭据，并在发现未经授权的访问后及时通知我们。
            你对账户下的活动负责。你必须年满 18 周岁，或达到所在地法定成年年龄。
            为防止欺诈和滥用，我们可能要求验证邮箱或进行其他检查。
          </p>
        </section>
        <section>
          <h2>4. 付费方案与月度用量</h2>
          <p>
            付费方案提供 Anybox Managed AI 访问权和包含的月度服务用量。该用量是
            不可转让的服务权益，不是货币、储值、礼品卡或支付工具，不能提取、转让、
            兑换现金或用于购买第三方商品或服务。除非方案另有明确说明，未使用的月度
            用量会在对应计费周期结束时失效且不会结转。
          </p>
          <p>
            我们不销售或交付上游供应商账户、API Key、礼品卡、优惠券或原始第三方额度。
            不同方案的模型可用范围、速率限制、并发量和用量可能不同，并可能按定价页说明
            或向受影响订阅者发出的通知进行调整。
          </p>
        </section>
        <section>
          <h2>5. 订单、计费与 Merchant of Record</h2>
          <p>
            价格、计费频率、续订条件和适用税费会在购买前展示。如果结账页显示 Paddle，
            则 Paddle.com 作为我们的在线经销商和 Merchant of Record 处理订单、付款相关
            的买家支持及退货退款。如使用其他 Merchant of Record，将在结账时标明。
          </p>
          <p>
            订阅会自动续订，直到取消。你授权 Merchant of Record 在每次续订时向所选
            付款方式收费。你可以在下一次续订前通过可用的账单门户或联系支持取消。
            取消和退款规则见<a href="/refunds/">退款与取消政策</a>。
          </p>
        </section>
        <section>
          <h2>6. 可接受使用与 AI 内容</h2>
          <p>
            你必须遵守<a href="/acceptable-use/">可接受使用政策</a>、适用法律和上游
            供应商要求。不得使用 Anybox 生成非法、欺诈、滥用、侵权、色情、NSFW 或
            有害内容。禁止换脸、欺骗性深度伪造、未经同意的私密内容、涉及未成年人的
            性内容、恶意软件、凭据窃取及绕过安全控制的行为。
          </p>
          <p>
            我们可能采用自动审核、速率限制、调查、暂停或终止措施。你仍需对提示词、
            上传内容、工具操作、生成结果以及对其使用或发布的方式负责。
          </p>
        </section>
        <section>
          <h2>7. 第三方服务与输出</h2>
          <p>
            Anybox 可能把请求路由至第三方 AI、云服务、支付、邮件、审核或集成供应商。
            这些服务可能变更、中断或受独立条款约束。AI 输出可能不准确、不完整、令人不适
            或并非唯一，重要用途前必须独立复核。请勿将输出作为专业法律、医疗、金融或
            其他受监管建议。
          </p>
        </section>
        <section>
          <h2>8. 知识产权</h2>
          <p>
            Anybox 保留其托管服务、品牌、网站和非开源材料的权利。开源组件继续受各自
            许可证约束。在适用法律、第三方权利和模型供应商条款的前提下，你保留对合法
            拥有的输入和输出的权利，并授予我们处理内容和提供所请求服务所必需的有限权利。
          </p>
        </section>
        <section>
          <h2>9. 暂停与终止</h2>
          <p>
            为处理安全威胁、欺诈、付款失败、非法活动、政策违规、供应商要求或对用户及
            服务的重大风险，我们可在合理必要时限制或暂停访问。对重复或严重违规，我们
            可终止服务。在可行且合法的情况下，我们会发出通知并提供联系支持的机会。
          </p>
        </section>
        <section>
          <h2>10. 免责声明</h2>
          <p>
            在法律允许的最大范围内，服务按“现状”和“可用状态”提供。我们不保证访问
            不会中断、特定模型始终可用、输出没有错误或 AI 输出符合你的要求。法律规定的
            强制性消费者权利不受排除。
          </p>
        </section>
        <section>
          <h2>11. 责任限制</h2>
          <p>
            在法律允许的最大范围内，Anybox 不对间接、附带、特殊、后果性或惩罚性损害，
            以及利润、数据、商誉或商业机会损失承担责任。与付费服务相关的累计责任不超过
            引发索赔事件前十二个月内你为该服务支付的金额。法律禁止限制的情形除外。
          </p>
        </section>
        <section>
          <h2>12. 条款变更</h2>
          <p>
            我们可能为反映产品、供应商、付款、法律或安全变化而更新本条款，页面顶部会
            显示更新日期。如果重大变更影响有效付费订阅，我们会在要求时提供合理通知。
          </p>
        </section>
        <section>
          <h2>13. 联系我们</h2>
          <p>
            问题、投诉、取消请求或法律通知可发送至
            <a href={supportMailto}>{supportEmail}</a>。我们力争在三个工作日内回复支持请求。
          </p>
        </section>
      </PolicyLayout>
    )
  }

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
