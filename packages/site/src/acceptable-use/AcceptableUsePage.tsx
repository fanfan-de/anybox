import { useEffect } from "react"
import { useSiteLanguage } from "../language"
import { PolicyLayout } from "../policies/PolicyLayout"
import { supportEmail, supportMailto } from "../siteLinks"

export function AcceptableUsePage() {
  const { language } = useSiteLanguage()

  useEffect(() => {
    document.title = language === "zh" ? "Anybox 可接受使用政策" : "Anybox Acceptable Use Policy"
  }, [language])

  if (language === "zh") {
    return (
      <PolicyLayout
        kicker="可接受使用政策"
        title="负责任地使用 Anybox"
        titleId="acceptable-use-title"
        updated="2026 年 7 月 12 日"
      >
        <section>
          <h2>1. 目的</h2>
          <p>
            本可接受使用政策适用于 Anybox Managed AI、Anybox 托管服务，以及使用
            Anybox 工具与第三方系统交互的行为。你必须遵守适用法律、他人权利、上游
            供应商政策和本政策。
          </p>
        </section>
        <section>
          <h2>2. 色情与剥削性内容</h2>
          <p>不得使用 Anybox 创建、请求、传播或协助：</p>
          <ul>
            <li>性剥削或任何涉及未成年人的性内容。</li>
            <li>未经同意的私密影像或色情化描绘。</li>
            <li>NSFW、色情、露骨或性暗示 AI 内容。</li>
            <li>性交易、诱骗、性勒索或相关剥削行为。</li>
          </ul>
        </section>
        <section>
          <h2>3. 冒充与合成媒体</h2>
          <p>不得使用 Anybox 从事：</p>
          <ul>
            <li>换脸、欺骗性深度伪造或人脸操纵。</li>
            <li>声音冒充或欺骗性使用他人肖像。</li>
            <li>未经本人同意或其他合法授权，使用可识别个人肖像生成内容。</li>
            <li>欺诈性冒充、身份盗用或虚假关联。</li>
          </ul>
        </section>
        <section>
          <h2>4. 伤害、犯罪与危险活动</h2>
          <p>不得使用 Anybox 实施或实质协助：</p>
          <ul>
            <li>暴力、恐怖主义、虐待、骚扰或可信威胁。</li>
            <li>以伤害为目的的武器制造或获取。</li>
            <li>非法毒品、贩运、赌博或其他违法交易。</li>
            <li>鼓励自残或增加紧迫风险的操作指示。</li>
            <li>人口贩运、剥削、跟踪或人身监控。</li>
          </ul>
        </section>
        <section>
          <h2>5. 网络安全与平台滥用</h2>
          <p>不得使用 Anybox 从事：</p>
          <ul>
            <li>恶意软件、勒索软件、破坏性载荷或凭据窃取。</li>
            <li>未经授权的访问、漏洞利用或数据外泄。</li>
            <li>网络钓鱼、垃圾信息、诈骗、批量养号或付款欺诈。</li>
            <li>绕过安全防护、审核、速率限制、访问控制、付款控制或上游供应商限制。</li>
            <li>干扰服务或给基础设施造成不合理负载。</li>
          </ul>
        </section>
        <section>
          <h2>6. 隐私与知识产权</h2>
          <p>你不得：</p>
          <ul>
            <li>在缺乏合法依据或必要同意的情况下处理个人数据。</li>
            <li>收集或暴露密钥、凭据或私人通信。</li>
            <li>侵犯著作权、商标、商业秘密、隐私权或肖像权。</li>
            <li>违反法律或平台条款下载、抓取、复制或重新分发第三方内容。</li>
          </ul>
        </section>
        <section>
          <h2>7. 高影响决策与专业建议</h2>
          <p>
            不得将 Anybox 作为决定个人在就业、住房、教育、信贷、保险、医疗、法律服务
            或基本公共服务方面资格、访问权或权利的唯一依据。必须由合格人员复核，并采用
            法律要求的全部保障措施。不得把 AI 输出表述为持牌专业建议。
          </p>
        </section>
        <section>
          <h2>8. 图片与视频生成</h2>
          <p>
            付费图片或视频生成可能受到自动审核，以及 Merchant of Record 或上游供应商的
            额外控制。不得将 Anybox 宣传、配置或用作“无审查”“无过滤”“NSFW”或不过滤的
            生成服务。生成媒体必须遵守本政策其他全部条款。
          </p>
        </section>
        <section>
          <h2>9. 执行措施</h2>
          <p>
            我们可能使用自动和人工信号调查疑似滥用，并可能拦截内容或请求、降低限额、保存
            相关安全证据、暂停或终止账户、撤销权益，或在法律要求时报告相关行为。为防止伤害、
            欺诈或服务受损而合理需要立即行动时，执行措施可能不另行事先通知。
          </p>
        </section>
        <section>
          <h2>10. 举报</h2>
          <p>
            如发现疑似滥用、非法内容、知识产权问题或安全问题，请发送邮件至
            <a href={supportMailto}>{supportEmail}</a>。请提供足以定位和评估问题的信息，但
            不要发送密码、完整银行卡信息或不必要的敏感个人数据。
          </p>
        </section>
      </PolicyLayout>
    )
  }

  return (
    <PolicyLayout
      kicker="Acceptable Use Policy"
      title="Use Anybox responsibly"
      titleId="acceptable-use-title"
      updated="July 12, 2026"
    >
      <section>
        <h2>1. Purpose</h2>
        <p>
          This Acceptable Use Policy applies to Anybox Managed AI, hosted Anybox
          services, and use of Anybox tools to interact with third-party systems.
          You must follow applicable law, the rights of others, upstream provider
          policies, and this policy.
        </p>
      </section>

      <section>
        <h2>2. Sexual and Exploitative Content</h2>
        <p>You may not use Anybox to create, request, distribute, or facilitate:</p>
        <ul>
          <li>Sexual exploitation or any sexual content involving minors.</li>
          <li>Non-consensual intimate imagery or sexualized depictions.</li>
          <li>NSFW, pornographic, explicit, or sexually suggestive AI content.</li>
          <li>Sex trafficking, grooming, sextortion, or related exploitation.</li>
        </ul>
      </section>

      <section>
        <h2>3. Impersonation and Manipulated Media</h2>
        <p>You may not use Anybox for:</p>
        <ul>
          <li>Face swaps, deceptive deepfakes, or face-manipulation tools.</li>
          <li>Voice impersonation or deceptive use of a person's likeness.</li>
          <li>
            Generated content using an identifiable person's likeness without
            the consent or other lawful authorization required for that use.
          </li>
          <li>Fraudulent impersonation, identity theft, or deceptive affiliation.</li>
        </ul>
      </section>

      <section>
        <h2>4. Harm, Crime, and Dangerous Activity</h2>
        <p>You may not use Anybox to enable or materially assist:</p>
        <ul>
          <li>Violence, terrorism, abuse, harassment, or credible threats.</li>
          <li>Weapons construction or acquisition intended to cause harm.</li>
          <li>Illegal drugs, trafficking, gambling, or other unlawful commerce.</li>
          <li>Self-harm encouragement or instructions that increase imminent risk.</li>
          <li>Human trafficking, exploitation, stalking, or physical surveillance.</li>
        </ul>
      </section>

      <section>
        <h2>5. Cybersecurity and Platform Abuse</h2>
        <p>You may not use Anybox for:</p>
        <ul>
          <li>Malware, ransomware, destructive payloads, or credential theft.</li>
          <li>Unauthorized access, vulnerability exploitation, or data exfiltration.</li>
          <li>Phishing, spam, scams, account farming, or payment fraud.</li>
          <li>
            Circumventing safeguards, moderation, rate limits, access controls,
            payment controls, or upstream provider restrictions.
          </li>
          <li>Disrupting the service or imposing unreasonable infrastructure load.</li>
        </ul>
      </section>

      <section>
        <h2>6. Privacy and Intellectual Property</h2>
        <p>You may not:</p>
        <ul>
          <li>Process personal data without a lawful basis or required consent.</li>
          <li>Collect or expose secrets, credentials, or private communications.</li>
          <li>Infringe copyright, trademark, trade secret, privacy, or publicity rights.</li>
          <li>
            Download, scrape, copy, or redistribute third-party content in
            violation of law or platform terms.
          </li>
        </ul>
      </section>

      <section>
        <h2>7. High-Impact Decisions and Professional Advice</h2>
        <p>
          Anybox must not be used as the sole basis for decisions that determine
          a person's eligibility, access, or rights in employment, housing,
          education, credit, insurance, healthcare, legal services, or essential
          public services. Qualified human review and all legally required
          safeguards must be used. Do not present AI output as licensed
          professional advice.
        </p>
      </section>

      <section>
        <h2>8. Image and Video Generation</h2>
        <p>
          Paid image or video generation may be subject to automated moderation
          and additional Merchant of Record or upstream provider controls. You
          may not market, configure, or use Anybox as an "uncensored," "no
          filter," "NSFW," or unfiltered generation service. Generated media must
          comply with all other sections of this policy.
        </p>
      </section>

      <section>
        <h2>9. Enforcement</h2>
        <p>
          We may use automated and manual signals to investigate suspected abuse.
          We may block content or requests, reduce limits, preserve relevant
          security evidence, suspend or terminate accounts, revoke entitlements,
          or report conduct where required by law. Enforcement may occur without
          prior notice where immediate action is reasonably necessary to prevent
          harm, fraud, or service compromise.
        </p>
      </section>

      <section>
        <h2>10. Reporting</h2>
        <p>
          Report suspected abuse, illegal content, intellectual-property
          concerns, or security issues to
          {" "}
          <a href={supportMailto}>{supportEmail}</a>. Include enough information
          to locate and evaluate the issue, but do not send passwords, full card
          details, or unnecessary sensitive personal data.
        </p>
      </section>
    </PolicyLayout>
  )
}
