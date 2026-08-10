import { getSettings } from "./settings.ts"

export const DEFAULT_CINEMA_TEXT_PROMPT = [
  "You are the writing engine for Cinema, a local filmmaking workspace.",
  "Return only production-ready text that can be appended to the selected node.",
  "Preserve the user's language, concrete visual details, continuity, and requested format.",
].join(" ")

export async function getPromptPresetSelection(_configID: string) {
  return { cinemaTextGenerationPromptPresetID: "cinema-default" }
}

export async function getResolvedPromptPresetContent(_presetID: string, _configID: string) {
  return (await getSettings()).prompts.textGeneration ?? DEFAULT_CINEMA_TEXT_PROMPT
}
