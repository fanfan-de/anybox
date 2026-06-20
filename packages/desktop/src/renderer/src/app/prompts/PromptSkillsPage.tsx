import type { ReactNode } from "react"
import { useI18n } from "../i18n/I18nProvider"
import { ShellTopMenu } from "../shared-ui"

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

  return (
    <section className="prompt-skills-page" aria-label={t("resources.pageAria")}>
      <ShellTopMenu
        as="header"
        ariaLabel={t("resources.topMenuAria")}
        className="canvas-region-top-menu prompt-skills-top-menu"
        contentClassName="canvas-region-top-menu-tabs-shell prompt-skills-top-menu-content"
        content={(
          <div className="global-skills-mode-toggle prompt-skills-mode-toggle window-no-drag-region" role="group" aria-label={t("resources.modeAria")}>
            {promptSkillModeOptions.map((option) => (
              <button
                key={option.mode}
                className={mode === option.mode ? "global-skills-mode-button is-active" : "global-skills-mode-button"}
                type="button"
                aria-pressed={mode === option.mode}
                onClick={() => onModeChange(option.mode)}
              >
                {t(option.labelKey)}
              </button>
            ))}
          </div>
        )}
        dragRegion
        leading={null}
        layout="three-column"
        trailing={windowControls}
        trailingClassName="prompt-presets-top-menu-window-controls"
      />

      <div className={`prompt-skills-page-body is-${mode}`}>
        {children}
      </div>
    </section>
  )
}
