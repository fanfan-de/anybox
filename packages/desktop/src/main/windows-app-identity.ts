export const PACKAGED_WINDOWS_APP_USER_MODEL_ID = "com.anybox.app"
export const DEVELOPMENT_WINDOWS_APP_USER_MODEL_ID = "com.anybox.app.dev"

export function resolveWindowsAppUserModelId(
  isPackaged: boolean,
  platform: NodeJS.Platform = process.platform,
) {
  if (platform !== "win32") return undefined

  return isPackaged
    ? PACKAGED_WINDOWS_APP_USER_MODEL_ID
    : DEVELOPMENT_WINDOWS_APP_USER_MODEL_ID
}
