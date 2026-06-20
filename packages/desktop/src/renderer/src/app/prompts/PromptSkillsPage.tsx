import type { ReactNode } from "react"
import { useI18n } from "../i18n/I18nProvider"
import { joinClassNames, ShellTopMenu } from "../shared-ui"

export type PromptSkillMode = "prompts" | "skills"

interface PromptSkillsPageProps {
  children: ReactNode
  mode: PromptSkillMode
  windowControls?: ReactNode
  onModeChange: (mode: PromptSkillMode) => void
}

const promptSkillModeOptions: Array<{
  mode: PromptSkillMode
  labelKey: "resources.mode.prompts" | "resources.mode.skills"
}> = [
  { mode: "prompts", labelKey: "resources.mode.prompts" },
  { mode: "skills", labelKey: "resources.mode.skills" },
]

export function PromptSkillsPage({
  children,
  mode,
  windowControls,
  onModeChange,
}: PromptSkillsPageProps) {
  const { t } = useI18n()
  const activeTabID = `prompt-skills-mode-tab-${mode}`

  return (
    <section className="prompt-skills-page" aria-label={t("resources.pageAria")}>
      <ShellTopMenu
        as="header"
        ariaLabel={t("resources.topMenuAria")}
        className="canvas-region-top-menu prompt-skills-top-menu"
        contentClassName="canvas-region-top-menu-tabs-shell prompt-skills-top-menu-content"
        content={(
          <nav className="top-menu-segment-list prompt-skills-mode-toggle window-no-drag-region" role="tablist" aria-label={t("resources.modeAria")}>
            {promptSkillModeOptions.map((option) => {
              const isActive = mode === option.mode

              return (
                <button
                  key={option.mode}
                  id={`prompt-skills-mode-tab-${option.mode}`}
                  className={joinClassNames("top-menu-segment prompt-skills-mode-tab", isActive ? "is-active" : null)}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-controls="prompt-skills-tab-panel"
                  onClick={() => onModeChange(option.mode)}
                >
                  {t(option.labelKey)}
                </button>
              )
            })}
          </nav>
        )}
        dragRegion
        leading={null}
        layout="three-column"
        trailing={windowControls}
        trailingClassName="prompt-presets-top-menu-window-controls"
      />

      <div
        id="prompt-skills-tab-panel"
        className={`prompt-skills-page-body is-${mode}`}
        role="tabpanel"
        aria-labelledby={activeTabID}
      >
        {children}
      </div>
    </section>
  )
}
