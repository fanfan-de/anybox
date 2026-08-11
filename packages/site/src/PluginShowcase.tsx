import { useState } from "react"
import type { SiteContent } from "./content"
import type { SiteLanguage } from "./language"

type PluginExample = SiteContent["plugins"]["examples"][number]

const pluginIcons: Record<string, string> = {
  "build-web-apps": "/plugin-icons/build-web-apps.svg",
  "game-studio": "/plugin-icons/game-studio.svg",
  chrome: "/plugin-icons/chrome.svg",
  gmail: "/plugin-icons/gmail.svg",
  "google-drive": "/plugin-icons/google-drive.svg",
  notion: "/plugin-icons/notion.svg",
  slack: "/plugin-icons/slack.svg",
  canva: "/plugin-icons/canva.svg",
  cloudflare: "/plugin-icons/cloudflare.png",
  linear: "/plugin-icons/linear.svg",
  supabase: "/plugin-icons/supabase.svg",
  vercel: "/plugin-icons/vercel-mark.svg",
}

function MotionToggleIcon({ paused }: { paused: boolean }) {
  if (paused) {
    return (
      <svg aria-hidden="true" viewBox="0 0 20 20">
        <path d="M6.5 4.7v10.6L15 10 6.5 4.7Z" fill="currentColor" />
      </svg>
    )
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="M5.75 4.5h3v11h-3v-11Zm5.5 0h3v11h-3v-11Z" fill="currentColor" />
    </svg>
  )
}

function PluginCard({ example }: { example: PluginExample }) {
  return (
    <li className="plugin-conveyor-card">
      <span className="plugin-conveyor-icon">
        <img
          alt=""
          decoding="async"
          height="42"
          src={pluginIcons[example.id]}
          width="42"
        />
      </span>
      <span className="plugin-conveyor-name">{example.name}</span>
    </li>
  )
}

type PluginShowcaseProps = {
  content: SiteContent["plugins"]
  language: SiteLanguage
}

export function PluginShowcase({ content, language }: PluginShowcaseProps) {
  const [isPaused, setIsPaused] = useState(false)
  const rowBreak = Math.ceil(content.examples.length / 2)
  const pluginRows = [
    content.examples.slice(0, rowBreak),
    content.examples.slice(rowBreak),
  ]
  const pauseLabel = language === "zh" ? "暂停插件动态" : "Pause plugin motion"
  const resumeLabel = language === "zh" ? "继续插件动态" : "Resume plugin motion"
  const controlLabel = isPaused ? resumeLabel : pauseLabel

  return (
    <section
      className="plugin-showcase-section"
      id="plugins"
      aria-labelledby="plugin-title"
    >
      <div className="plugin-showcase-inner">
        <div className="plugin-conveyor-stage">
          <div className="plugin-conveyor-actions">
            <button
              aria-label={controlLabel}
              aria-pressed={isPaused}
              className="plugin-conveyor-toggle"
              onClick={() => setIsPaused((paused) => !paused)}
              title={controlLabel}
              type="button"
            >
              <MotionToggleIcon paused={isPaused} />
            </button>
          </div>

          <div className="plugin-conveyor-rows" aria-hidden="true">
            {pluginRows.map((examples, rowIndex) => (
              <div className="plugin-conveyor-viewport" key={rowIndex === 0 ? "top" : "bottom"}>
                <div
                  className={[
                    "plugin-conveyor-track",
                    rowIndex === 0 ? "is-forward" : "is-reverse",
                    isPaused ? "is-paused" : "",
                  ].filter(Boolean).join(" ")}
                >
                  {[false, true].map((isDuplicate) => (
                    <ul
                      aria-hidden={isDuplicate ? "true" : undefined}
                      className="plugin-conveyor-group"
                      key={isDuplicate ? "duplicate" : "primary"}
                    >
                      {examples.map((example) => (
                        <PluginCard example={example} key={example.id} />
                      ))}
                    </ul>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="plugin-showcase-heading">
          <p className="section-kicker">{content.eyebrow}</p>
          <div className="plugin-showcase-copy">
            <h2 id="plugin-title">{content.title}</h2>
            <p>{content.description}</p>
          </div>
          <a className="plugin-docs-link" href="/docs/?doc=plugin-development">
            {content.docsLabel}
            <span aria-hidden="true">↗</span>
          </a>
        </div>

        <ol className="plugin-showcase-stages">
          {content.stages.map((stage, index) => (
            <li key={stage.title}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <div>
                <h3>{stage.title}</h3>
                <p>{stage.description}</p>
              </div>
            </li>
          ))}
        </ol>

        <ul className="plugin-showcase-accessible-list">
          {content.examples.map((example) => (
            <li key={example.id}>{example.name}</li>
          ))}
        </ul>
      </div>
    </section>
  )
}
