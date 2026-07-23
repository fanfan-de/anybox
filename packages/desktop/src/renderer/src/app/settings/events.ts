export const OPEN_ENVIRONMENT_SETTINGS_EVENT = "anybox:open-environment-settings"
export const ENVIRONMENT_SETTINGS_SECTION_STORAGE_KEY = "anybox.settings.open-environments"

export function requestOpenEnvironmentSettings() {
  window.dispatchEvent(new Event(OPEN_ENVIRONMENT_SETTINGS_EVENT))
}
