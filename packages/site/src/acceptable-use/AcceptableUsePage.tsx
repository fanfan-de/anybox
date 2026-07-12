import { PolicyLayout } from "../policies/PolicyLayout"
import { supportEmail, supportMailto } from "../siteLinks"

export function AcceptableUsePage() {
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
