import { AtmosphereBackground } from "../AtmosphereBackground"

const brandLogoBlack = "/brand-logo-black.svg"
const issuesUrl = "https://github.com/fanfan-de/anybox/issues"

function PrivacyHeader() {
  return (
    <header className="site-header privacy-header">
      <a className="brand-lockup" href="/" aria-label="Anybox home">
        <img src={brandLogoBlack} alt="" />
        <span>Anybox</span>
      </a>
      <nav className="docs-header-nav" aria-label="Privacy page navigation">
        <a href="/docs/">Docs</a>
        <a href={issuesUrl} rel="noreferrer" target="_blank">
          Contact
        </a>
      </nav>
    </header>
  )
}

export function PrivacyPage() {
  return (
    <main className="privacy-page-shell">
      <AtmosphereBackground />
      <PrivacyHeader />
      <article className="privacy-content" aria-labelledby="privacy-title">
        <p className="section-kicker">Privacy Policy</p>
        <h1 id="privacy-title">Anybox Privacy Policy</h1>
        <p className="privacy-updated">Last updated: June 17, 2026</p>

        <section>
          <h2>Overview</h2>
          <p>
            Anybox is a local-first desktop agent and browser automation tool.
          </p>
        </section>

        <section>
          <h2>Chrome Extension</h2>
          <p>
            The Anybox Chrome extension connects Chrome to the locally installed
            Anybox Desktop application. The extension may access browser tabs,
            page content, screenshots, DOM information, accessibility
            information, and user-initiated browser actions only when the user
            uses Anybox browser automation features.
          </p>
        </section>

        <section>
          <h2>Data Handling</h2>
          <p>
            Data handled by the extension is sent to the user's local Anybox
            Desktop Agent through Chrome Native Messaging or a localhost
            connection. The extension does not sell user data and does not use
            data for advertising or tracking.
          </p>
          <p>
            Anybox does not collect personal data through the Chrome extension
            for third-party advertising, analytics, or profiling. Any page
            content accessed by the extension is used only to complete
            user-requested local browser automation tasks.
          </p>
        </section>

        <section>
          <h2>Local Storage</h2>
          <p>
            The extension stores limited local state, such as connection status,
            extension instance ID, and local transport preferences, using Chrome
            storage.
          </p>
        </section>

        <section>
          <h2>User Control</h2>
          <p>
            Users can disable or remove the extension at any time from Chrome's
            extension settings.
          </p>
        </section>

        <section>
          <h2>Contact</h2>
          <p>
            For privacy questions or requests, contact the Anybox project
            through GitHub Issues:
          </p>
          <p>
            <a href={issuesUrl} rel="noreferrer" target="_blank">
              {issuesUrl}
            </a>
          </p>
        </section>
      </article>
    </main>
  )
}
