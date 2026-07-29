import { GitBranchSwitcher } from "./GitBranchSwitcher"
import { useI18n } from "./i18n/I18nProvider"

interface ComposerUtilityBarProps {
  gitDirectory: string | null
  gitProjectID: string | null
  showGitControls?: boolean
}

export function ComposerUtilityBar({
  gitDirectory,
  gitProjectID,
  showGitControls = true,
}: ComposerUtilityBarProps) {
  const { t } = useI18n()
  if (!showGitControls) return null

  return (
    <div className="composer-utility-bar" aria-label={t("composer.utilityBar")}>
      <GitBranchSwitcher projectID={gitProjectID} directory={gitDirectory} />
    </div>
  )
}
