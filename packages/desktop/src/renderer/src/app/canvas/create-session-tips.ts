import type { TranslationKey } from "../i18n/translations"

export interface CreateSessionUsageTip {
  id: string
  messageKey: TranslationKey
}

export const CREATE_SESSION_USAGE_TIPS: readonly CreateSessionUsageTip[] = [
  { id: "define-acceptance", messageKey: "createSession.tip.defineAcceptance" },
  { id: "plan-first", messageKey: "createSession.tip.planFirst" },
  { id: "analyze-only", messageKey: "createSession.tip.analyzeOnly" },
  { id: "share-reproduction", messageKey: "createSession.tip.shareReproduction" },
  { id: "mention-files", messageKey: "createSession.tip.mentionFiles" },
  { id: "verify-changes", messageKey: "createSession.tip.verifyChanges" },
  { id: "use-skills", messageKey: "createSession.tip.useSkills" },
  { id: "connect-mcp", messageKey: "createSession.tip.connectMcp" },
  { id: "use-plugins", messageKey: "createSession.tip.usePlugins" },
  { id: "control-permissions", messageKey: "createSession.tip.controlPermissions" },
  { id: "delegate-agents", messageKey: "createSession.tip.delegateAgents" },
  { id: "use-side-chat", messageKey: "createSession.tip.useSideChat" },
]

function normalizeRandomValue(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0
  if (value >= 1) return 1 - Number.EPSILON
  return value
}

export function pickCreateSessionUsageTipIndex(
  currentIndex: number,
  tipCount: number,
  random: () => number = Math.random,
) {
  if (tipCount <= 0) return -1
  if (tipCount === 1) return 0

  const randomValue = normalizeRandomValue(random())
  if (currentIndex < 0 || currentIndex >= tipCount) {
    return Math.floor(randomValue * tipCount)
  }

  const nextIndexWithoutCurrent = Math.floor(randomValue * (tipCount - 1))
  return nextIndexWithoutCurrent >= currentIndex ? nextIndexWithoutCurrent + 1 : nextIndexWithoutCurrent
}
