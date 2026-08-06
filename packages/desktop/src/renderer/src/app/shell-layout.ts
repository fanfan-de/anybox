export const SHELL_LAYOUT_MODE_STORAGE_KEY = "desktop.shellLayoutMode.v1"

export type ShellLayoutMode = "workbench-primary" | "tools-primary"
export type ShellRegionRole = "primary" | "companion"
export type ShellSurfaceID = "workbench" | "tools"

export interface ShellLayoutDefinition {
  companion: ShellSurfaceID
  primary: ShellSurfaceID
}

export const DEFAULT_SHELL_LAYOUT_MODE: ShellLayoutMode = "workbench-primary"

export const SHELL_LAYOUTS: Record<ShellLayoutMode, ShellLayoutDefinition> = {
  "workbench-primary": {
    companion: "tools",
    primary: "workbench",
  },
  "tools-primary": {
    companion: "workbench",
    primary: "tools",
  },
}

export function normalizeShellLayoutMode(value: unknown): ShellLayoutMode {
  return value === "tools-primary" || value === "workbench-primary"
    ? value
    : DEFAULT_SHELL_LAYOUT_MODE
}

export function readShellLayoutMode(storage?: Pick<Storage, "getItem"> | null): ShellLayoutMode {
  if (!storage) return DEFAULT_SHELL_LAYOUT_MODE

  try {
    return normalizeShellLayoutMode(storage.getItem(SHELL_LAYOUT_MODE_STORAGE_KEY))
  } catch {
    return DEFAULT_SHELL_LAYOUT_MODE
  }
}

export function getShellRegionRole(mode: ShellLayoutMode, surface: ShellSurfaceID): ShellRegionRole {
  return SHELL_LAYOUTS[mode].primary === surface ? "primary" : "companion"
}
