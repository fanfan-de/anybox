import type { DesktopIpcInput, DesktopIpcOutput } from "../../../../shared/desktop-ipc-contract"

export async function openExternalUrl(url: string) {
  await window.desktop?.openExternalUrl?.({ url })
}

export async function openMonitorWindow(): Promise<DesktopIpcOutput<"desktop:open-monitor-window"> | null> {
  return window.desktop?.openMonitorWindow?.() ?? null
}

export async function openAppearanceWindow(): Promise<DesktopIpcOutput<"desktop:open-appearance-window"> | null> {
  return window.desktop?.openAppearanceWindow?.() ?? null
}

export async function getAppUpdateSettings(): Promise<DesktopIpcOutput<"desktop:get-app-update-settings"> | null> {
  return window.desktop?.getAppUpdateSettings?.() ?? null
}

export async function getAppUpdateState(): Promise<DesktopIpcOutput<"desktop:get-app-update-state"> | null> {
  return window.desktop?.getAppUpdateState?.() ?? null
}

export async function setAutomaticUpdatesEnabled(
  enabled: boolean,
): Promise<DesktopIpcOutput<"desktop:set-automatic-updates-enabled"> | null> {
  const input: DesktopIpcInput<"desktop:set-automatic-updates-enabled"> = { enabled }
  return window.desktop?.setAutomaticUpdatesEnabled?.(input) ?? null
}

export async function checkForAppUpdates(): Promise<DesktopIpcOutput<"desktop:check-for-app-updates"> | null> {
  return window.desktop?.checkForAppUpdates?.() ?? null
}

export async function installAppUpdate(): Promise<DesktopIpcOutput<"desktop:install-app-update"> | null> {
  return window.desktop?.installAppUpdate?.() ?? null
}

export async function getStoragePaths(): Promise<DesktopIpcOutput<"desktop:get-storage-paths"> | null> {
  return window.desktop?.getStoragePaths?.() ?? null
}
