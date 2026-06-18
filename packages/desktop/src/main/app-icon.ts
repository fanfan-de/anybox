import { app } from "electron"
import fs from "node:fs"
import path from "node:path"

export function resolveAppIconPath(mainDir: string) {
  const rootDir = app.getAppPath()
  const iconFileName = process.platform === "win32" ? "icon.ico" : "icon.png"
  const candidatePaths = [
    ...(process.resourcesPath ? [path.join(process.resourcesPath, "build", iconFileName)] : []),
    path.join(process.cwd(), "build", iconFileName),
    path.join(rootDir, "build", iconFileName),
    path.join(mainDir, "../../build", iconFileName),
    path.join(mainDir, "../build", iconFileName),
  ]

  return candidatePaths.find((candidate) => fs.existsSync(candidate))
}
