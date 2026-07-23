import { useEffect } from "react"
import { useSiteLanguage } from "../language"
import { PolicyLayout } from "../policies/PolicyLayout"
import { supportEmail, supportMailto } from "../siteLinks"

export function PrivacyPage() {
  const { language } = useSiteLanguage()

  useEffect(() => {
    document.title = language === "zh" ? "Anybox 隐私政策" : "Anybox Privacy Policy"
  }, [language])

  if (language === "zh") {
    return (
      <PolicyLayout
        kicker="隐私政策"
        title="Anybox 隐私政策"
        titleId="privacy-title"
        updated="2026 年 7 月 23 日"
      >
        <section>
          <h2>1. 适用范围</h2>
          <p>
            本隐私政策说明 Anybox 如何通过官网、开源桌面应用、Chrome 扩展和
            Anybox Managed AI Provider 处理信息。桌面应用以本地优先；托管服务为
            可选功能，需要单独账户。
          </p>
        </section>
        <section>
          <h2>2. 我们处理的信息</h2>
          <ul>
            <li><strong>账户数据：</strong>姓名、邮箱、工作区和账户标识符、密码哈希、验证状态、登录会话及 OAuth 授权记录。</li>
            <li><strong>托管 AI 请求数据：</strong>你选择通过 Anybox Managed AI 发送的提示词、消息、附件、模型选择和生成结果。</li>
            <li><strong>用量和服务数据：</strong>模型名称、Token 或用量计数、请求状态、延迟、错误详情、服务成本、订阅权益和交易状态。</li>
            <li><strong>安全数据：</strong>为保护和运营服务所需的 IP 地址、请求标识符、认证类型、速率限制事件和管理审计记录。</li>
            <li><strong>支持数据：</strong>你在寻求帮助时选择发送的消息和诊断信息。</li>
          </ul>
        </section>
        <section>
          <h2>3. 托管 AI 请求</h2>
          <p>
            托管 AI 请求内容会传输给所选的上游 AI 供应商以执行请求。普通用量日志记录
            元数据和计量信息，不记录完整请求正文。为支持安全的幂等重试，符合条件的响应
            正文可能被加密并临时缓存，通常最长 24 小时，之后清除缓存内容。
          </p>
          <p>
            除非确有必要且你有权提交，否则请勿发送密钥、受监管数据或敏感个人信息。
            上游供应商会依其适用条款、隐私承诺和账户设置处理请求内容。
          </p>
        </section>
        <section>
          <h2>4. 桌面应用与 Chrome 扩展</h2>
          <p>
            Chrome 扩展用于连接 Chrome 和本地安装的 Anybox Desktop。使用浏览器自动化时，
            它可能处理浏览活动（包括标签页来源和 URL）、网站内容（包括页面文字、DOM、
            无障碍信息和截图）、用户发起的浏览器操作，以及你授权填写的表单数据。
            这些信息通过 Chrome Native Messaging 发送给本地安装的 Anybox 组件，再由本地
            Anybox Agent 仅为执行用户明确发起的任务而处理。
          </p>
          <p>
            扩展只保存连接与控制状态、扩展实例 ID、任务标签页租约和分组元数据等有限本地状态。
            它不读取 Cookie、Local Storage、浏览器保存的密码或其他凭据存储；敏感字段值不会被
            页面快照采集或写入诊断日志。浏览器内容不会用于广告或第三方画像。只有请求的功能需要
            远程服务时，例如上游模型或 Anybox Managed AI，内容才会离开本地设备。
          </p>
          <p>
            对通过 Google API 和 Chrome 扩展权限获得的信息，Anybox 的使用将遵守
            Chrome Web Store 用户数据政策，包括 Limited Use（有限使用）要求。此类信息不会被
            出售，也不会用于广告、信用评估或与 Chrome 浏览器控制功能无关的用途。
          </p>
        </section>
        <section>
          <h2>5. 付款</h2>
          <p>
            购买可能由 Paddle 等 Merchant of Record 或结账页显示的其他供应商处理。
            Merchant of Record 按其自身隐私政策处理付款凭据、税费、收据、退款和交易欺诈检查。
            Anybox 会接收激活和支持服务所需的交易与权益信息，但不会收到完整银行卡信息。
          </p>
        </section>
        <section>
          <h2>6. 信息用途</h2>
          <ul>
            <li>提供身份验证、模型路由、用量计量和支持。</li>
            <li>防止欺诈、滥用、禁止内容和服务攻击。</li>
            <li>维护可靠性、调查故障并改进功能。</li>
            <li>管理订阅、权益、取消和退款。</li>
            <li>履行法律、税务、支付网络和供应商义务。</li>
          </ul>
        </section>
        <section>
          <h2>7. 服务供应商与跨境处理</h2>
          <p>
            为提供和保护服务，我们可能在必要范围内与上游 AI 供应商、云和邮件基础设施
            供应商、欺诈和审核服务及 Merchant of Record 共享信息。这些供应商可能在你
            所在国家或地区之外处理信息。法律要求或为保护用户、Anybox 或公众时，我们也
            可能披露信息。
          </p>
        </section>
        <section>
          <h2>8. 保存期限与安全</h2>
          <p>
            我们会在服务交付、欺诈预防、争议处理、法律合规和合理业务需要所必需的期限内
            保存账户、交易、用量、安全和审计记录。临时加密响应缓存采用更短的运营保存期。
            我们使用访问控制、敏感服务密钥和合格缓存响应加密、密码哈希、速率限制和审计
            日志，但任何安全措施都不能保证绝对安全。
          </p>
        </section>
        <section>
          <h2>9. 你的选择与权利</h2>
          <p>
            你可以卸载扩展、停止使用 Managed AI、撤销已连接会话，或请求访问、更正、删除
            个人数据。因税务、欺诈、付款、安全或法律要求，部分记录可能需要保留。请求需
            经过身份验证并受适用法律约束。
          </p>
        </section>
        <section>
          <h2>10. 未成年人</h2>
          <p>
            Anybox Managed AI 不面向 18 周岁以下未成年人。在法律允许的情况下，未成年人
            不应在没有父母或法定监护人参与和同意的情况下使用该服务。
          </p>
        </section>
        <section>
          <h2>11. 变更与联系</h2>
          <p>
            我们可能随产品、供应商或法律要求的变化更新本政策，重大更新会通过页面顶部日期
            体现。如有隐私问题或请求，请发送邮件至
            <a href={supportMailto}>{supportEmail}</a>。
          </p>
        </section>
      </PolicyLayout>
    )
  }

  return (
    <PolicyLayout
      kicker="Privacy Policy"
      title="Anybox Privacy Policy"
      titleId="privacy-title"
      updated="July 23, 2026"
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
          browsing activity (including tab origins and URLs), website content
          (including page text, DOM, accessibility information, and screenshots),
          user-initiated browser actions, and form data you authorize it to enter.
          This information is sent through Chrome Native Messaging to a locally
          installed Anybox component, and is processed by the local Anybox agent
          only to perform tasks you explicitly initiate.
        </p>
        <p>
          The extension stores limited local state such as connection and control
          status, an extension instance ID, task-tab leases, and tab-group
          metadata. It does not read cookies, Local Storage, browser-saved
          passwords, or other credential stores; sensitive field values are not
          captured in page snapshots or written to diagnostic logs. Browser
          content is not used for advertising or third-party profiling. Content
          leaves the local device only when a requested feature requires a remote
          service, such as an upstream model or Anybox Managed AI.
        </p>
        <p>
          Anybox&apos;s use of information received from Google APIs and Chrome
          extension permissions will adhere to the Chrome Web Store User Data
          Policy, including the Limited Use requirements. This information is
          not sold or used for advertising, creditworthiness, or purposes
          unrelated to Chrome browser control.
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
