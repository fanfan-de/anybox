import type { AppearanceCodeFontFamily } from "../../../shared/appearance"

export const CODE_FONT_FAMILY_STACKS: Record<AppearanceCodeFontFamily, string> = {
  default: "\"IBM Plex Mono\", \"JetBrains Mono\", \"Cascadia Code\", \"Consolas\", monospace",
  system: "ui-monospace, \"SFMono-Regular\", \"Cascadia Mono\", Menlo, Monaco, Consolas, \"Liberation Mono\", monospace",
  "jetbrains-mono": "\"JetBrains Mono\", \"IBM Plex Mono\", \"Cascadia Code\", Consolas, monospace",
  "cascadia-code": "\"Cascadia Code\", \"IBM Plex Mono\", Consolas, monospace",
  consolas: "Consolas, \"IBM Plex Mono\", \"Cascadia Mono\", monospace",
}

export function resolveCodeFontFamilyStack(codeFontFamily: AppearanceCodeFontFamily) {
  return CODE_FONT_FAMILY_STACKS[codeFontFamily]
}
