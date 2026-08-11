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

function PluginCard({ example, index }: { example: PluginExample; index: number }) {
  return (
    <li className="plugin-conveyor-card">
      <div className="plugin-conveyor-card-topline">
        <span className="plugin-conveyor-icon">
          <img
            alt=""
            decoding="async"
            height="42"
            src={pluginIcons[example.id]}
            width="42"
          />
        </span>
        <span className="plugin-conveyor-index">
          {String(index + 1).padStart(2, "0")}
        </span>
      </div>
      <p className="plugin-conveyor-category">{example.category}</p>
      <h3>{example.name}</h3>
      <p className="plugin-conveyor-description">{example.description}</p>
      <p className="plugin-conveyor-capability">{example.capability}</p>
    </li>
  )
}

type PluginShowcaseProps = {
  content: SiteContent["plugins"]
  language: SiteLanguage
}

export function PluginShowcase({ content, language }: PluginShowcaseProps) {
  const [isPaused, setIsPaused] = useState(false)
  const pauseLabel = language === "zh" ? "暂停插件动态" : "Pause plugin motion"
  const resumeLabel = language === "zh" ? "继续插件动态" : "Resume plugin motion"
  const controlLabel = isPaused ? resumeLabel : pauseLabel
  const featuredLabel = language === "zh"
    ? `${content.examples.length} 个精选插件`
    : `${content.examples.length} featured plugins`
  const motionStatus = isPaused
    ? language === "zh" ? "展示已暂停" : "Showcase paused"
    : featuredLabel

  return (
    <section
      className="plugin-showcase-section"
      id="plugins"
      aria-labelledby="plugin-title"
    >
      <div className="plugin-showcase-inner">
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

        <div className="plugin-conveyor-shell">
          <div className="plugin-conveyor-toolbar">
            <p>
              <span aria-hidden="true" className="plugin-conveyor-status-dot" />
              {language === "zh" ? "插件工作台" : "Plugin workbench"}
            </p>
            <div className="plugin-conveyor-controls">
              <span aria-live="polite">{motionStatus}</span>
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
          </div>

          <div className="plugin-conveyor-viewport" aria-hidden="true">
            <div className={isPaused ? "plugin-conveyor-track is-paused" : "plugin-conveyor-track"}>
              {[false, true].map((isDuplicate) => (
                <ul
                  aria-hidden={isDuplicate ? "true" : undefined}
                  className="plugin-conveyor-group"
                  key={isDuplicate ? "duplicate" : "primary"}
                >
                  {content.examples.map((example, index) => (
                    <PluginCard example={example} index={index} key={example.id} />
                  ))}
                </ul>
              ))}
            </div>
          </div>
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
            <li key={example.id}>
              <strong>{example.name}</strong>: {example.description}
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
