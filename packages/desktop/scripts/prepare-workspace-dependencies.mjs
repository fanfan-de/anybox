import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import fs from "node:fs"
import fsp from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  buildPowerShell7Args,
  requirePowerShell7Runtime,
} from "../../platform/src/powershell.ts"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const desktopDir = path.resolve(scriptDir, "..")
const runtimeDir = path.join(desktopDir, "build", "agent-runtime")
const cacheDir = path.join(desktopDir, "build", "workspace-dependencies-cache")
const dependenciesDir = path.join(runtimeDir, "dependencies")
const bundleVersion = "1.0.0"
const pythonVersion = "3.12.10"
const pythonMajorMinor = pythonVersion.split(".").slice(0, 2).join(".")
const pythonTag = pythonVersion.replaceAll(".", "")
const pythonEmbeddedZip = `python-${pythonVersion}-embed-amd64.zip`
const pythonEmbeddedUrl = `https://www.python.org/ftp/python/${pythonVersion}/${pythonEmbeddedZip}`
const pythonMacPkg = `python-${pythonVersion}-macos11.pkg`
const pythonMacPkgUrl = `https://www.python.org/ftp/python/${pythonVersion}/${pythonMacPkg}`
const linuxPythonRelease = "20250517"
const linuxPythonArchive = `cpython-${pythonVersion}+${linuxPythonRelease}-x86_64-unknown-linux-gnu-install_only_stripped.tar.gz`
const linuxPythonUrl = `https://github.com/astral-sh/python-build-standalone/releases/download/${linuxPythonRelease}/${linuxPythonArchive.replace("+", "%2B")}`
const linuxPythonSha256 = "0356bd1db292781a20e011d789f0c41ea5ec04731c8236c8185b53a54faf2871"
const getPipUrl = "https://bootstrap.pypa.io/get-pip.py"

export const LINUX_PYTHON_DISTRIBUTION = Object.freeze({
  project: "astral-sh/python-build-standalone",
  release: linuxPythonRelease,
  version: pythonVersion,
  archive: linuxPythonArchive,
  url: linuxPythonUrl,
  sha256: linuxPythonSha256,
})

function readEnv(key) {
  const value = process.env[key]?.trim()
  if (value) return value
  return undefined
}

export const NODE_PACKAGES = {
  docx: "9.6.1",
  pptxgenjs: "4.0.1",
  "pdfjs-dist": "5.6.205",
  "pdf-lib": "1.17.1",
  sharp: "0.34.5",
  "image-size": "1.2.1",
  pngjs: "7.0.0",
  "jpeg-js": "0.4.4",
  pixelmatch: "7.1.0",
  "tesseract.js": "7.0.0",
  jszip: "3.10.1",
  marked: "17.0.5",
}

export const PYTHON_PACKAGES = {
  "python-docx": "1.2.0",
  openpyxl: "3.1.5",
  pandas: "3.0.1",
  pillow: "12.2.0",
  pypdf: "6.10.0",
  reportlab: "4.4.9",
  lxml: "6.0.2",
  numpy: "2.3.5",
  pydantic: "2.13.3",
  "python-dateutil": "2.9.0.post0",
  pdf2image: "1.17.0",
}

async function pathExists(target) {
  try {
    await fsp.access(target)
    return true
  } catch {
    return false
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    windowsHide: true,
    ...options,
  })

  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}`)
  }
}

function getOtoolLibraries(filePath) {
  const result = spawnSync("otool", ["-L", filePath], {
    encoding: "utf8",
    windowsHide: true,
  })

  if (result.status !== 0) return []

  return result.stdout
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim().split(/\s+/)[0])
    .filter(Boolean)
}

async function collectFiles(rootDir, predicate) {
  const entries = await fsp.readdir(rootDir, { withFileTypes: true }).catch(() => [])
  const files = []

  for (const entry of entries) {
    const absolutePath = path.join(rootDir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(absolutePath, predicate)))
      continue
    }

    if (entry.isFile() && predicate(absolutePath)) {
      files.push(absolutePath)
    }
  }

  return files
}

async function downloadFile(url, target) {
  if (await pathExists(target)) return

  console.log(`[desktop][build] downloading ${url}`)
  const response = await fetch(url)
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`)
  }

  const bytes = Buffer.from(await response.arrayBuffer())
  await fsp.mkdir(path.dirname(target), { recursive: true })
  await fsp.writeFile(target, bytes)
}

async function sha256File(filePath) {
  const hash = createHash("sha256")
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk)
  return hash.digest("hex")
}

async function downloadVerifiedFile(url, target, expectedSha256) {
  if (await pathExists(target)) {
    const cachedSha256 = await sha256File(target)
    if (cachedSha256 === expectedSha256) return

    console.warn(`[desktop][build] replacing cached file with unexpected SHA-256: ${target}`)
    await fsp.rm(target, { force: true })
  }

  await downloadFile(url, target)
  const actualSha256 = await sha256File(target)
  if (actualSha256 !== expectedSha256) {
    await fsp.rm(target, { force: true })
    throw new Error(
      `Downloaded file SHA-256 mismatch for ${path.basename(target)}: expected ${expectedSha256}, got ${actualSha256}`,
    )
  }
}

async function expandArchive(zipPath, targetDir) {
  const powerShell = await requirePowerShell7Runtime()
  run(powerShell.executable, buildPowerShell7Args(
    `Expand-Archive -LiteralPath '${zipPath.replaceAll("'", "''")}' -DestinationPath '${targetDir.replaceAll("'", "''")}' -Force`,
  ))
}

function expandMacPackage(pkgPath, targetDir) {
  run("pkgutil", ["--expand-full", pkgPath, targetDir])
}

async function findFirstExecutable(rootDir, filename) {
  const entries = await fsp.readdir(rootDir, { withFileTypes: true }).catch(() => [])

  for (const entry of entries) {
    const absolutePath = path.join(rootDir, entry.name)
    if ((entry.isFile() || entry.isSymbolicLink()) && entry.name === filename) {
      return absolutePath
    }
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue

    const found = await findFirstExecutable(path.join(rootDir, entry.name), filename)
    if (found) return found
  }

  return undefined
}

async function writeJson(filePath, data) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true })
  await fsp.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8")
}

async function prepareNodeDependencies(input) {
  const nodeDir = path.join(input.dependenciesDir, "node")
  const nodeModulesDir = path.join(nodeDir, "node_modules")

  await fsp.mkdir(nodeDir, { recursive: true })
  await writeJson(path.join(nodeDir, "package.json"), {
    name: "anybox-workspace-node-dependencies",
    private: true,
    type: "module",
    dependencies: NODE_PACKAGES,
    trustedDependencies: ["sharp"],
  })

  console.log(`[desktop][build] installing workspace Node dependencies into ${nodeDir}`)
  run(input.bunBinary, ["install", "--cwd", nodeDir], { cwd: nodeDir })

  for (const packageName of Object.keys(NODE_PACKAGES)) {
    if (!(await pathExists(path.join(nodeModulesDir, packageName, "package.json")))) {
      throw new Error(`Workspace Node dependency was not installed: ${packageName}`)
    }
  }
}

async function updatePythonPathFile(pythonDir) {
  const pthPath = path.join(pythonDir, `python${pythonTag.slice(0, 3)}._pth`)
  let content = await fsp.readFile(pthPath, "utf8")
  if (!content.includes("Lib\\site-packages")) {
    content = content.replace(/(^|\r?\n)#?import site(\r?\n|$)/, "$1Lib\\site-packages\r\nimport site$2")
  }
  if (!content.includes("import site")) {
    content = `${content.trimEnd()}\r\nimport site\r\n`
  }
  await fsp.writeFile(pthPath, content, "utf8")
}

async function preparePythonDependencies(input) {
  if (process.platform === "darwin") {
    return prepareMacPythonDependencies(input)
  }

  if (process.platform === "linux") {
    return prepareLinuxPythonDependencies(input)
  }

  if (process.platform !== "win32" || process.arch !== "x64") {
    throw new Error("Workspace Python dependencies are currently supported only on Windows x64, macOS, and Linux x64.")
  }

  const pythonDir = path.join(input.dependenciesDir, "python")
  const pythonExe = path.join(pythonDir, "python.exe")
  const sitePackagesDir = path.join(pythonDir, "Lib", "site-packages")
  const zipPath = path.join(cacheDir, pythonEmbeddedZip)
  const getPipPath = path.join(cacheDir, "get-pip.py")

  await fsp.rm(pythonDir, { recursive: true, force: true })
  await fsp.mkdir(pythonDir, { recursive: true })
  await downloadFile(pythonEmbeddedUrl, zipPath)
  await expandArchive(zipPath, pythonDir)
  await fsp.mkdir(sitePackagesDir, { recursive: true })
  await updatePythonPathFile(pythonDir)
  await downloadFile(getPipUrl, getPipPath)

  console.log(`[desktop][build] bootstrapping pip for workspace Python at ${pythonDir}`)
  run(pythonExe, [getPipPath, "--no-warn-script-location"], { cwd: pythonDir })

  const requirementsPath = path.join(input.dependenciesDir, "python-requirements.txt")
  const requirements = Object.entries(PYTHON_PACKAGES)
    .map(([name, version]) => `${name}==${version}`)
    .join("\n")
  await fsp.writeFile(requirementsPath, `${requirements}\n`, "utf8")

  console.log(`[desktop][build] installing workspace Python dependencies into ${sitePackagesDir}`)
  installPythonPackages(pythonExe, requirementsPath, pythonDir)
}

async function ensurePip(pythonExe, cwd) {
  const pipProbe = spawnSync(pythonExe, ["-m", "pip", "--version"], {
    stdio: "ignore",
    windowsHide: true,
    cwd,
  })
  if (pipProbe.status === 0) return

  const getPipPath = path.join(cacheDir, "get-pip.py")
  await downloadFile(getPipUrl, getPipPath)
  console.log(`[desktop][build] bootstrapping pip for workspace Python at ${cwd}`)
  run(pythonExe, [getPipPath, "--no-warn-script-location"], { cwd })
}

function installPythonPackages(pythonExe, requirementsPath, cwd) {
  run(
    pythonExe,
    [
      "-m",
      "pip",
      "install",
      "--no-warn-script-location",
      "--only-binary=:all:",
      "-r",
      requirementsPath,
    ],
    { cwd },
  )
}

async function prepareLinuxPythonDependencies(input) {
  if (process.arch !== "x64") {
    throw new Error(`Workspace Python dependencies are not supported on Linux ${process.arch}.`)
  }

  const pythonDir = path.join(input.dependenciesDir, "python")
  const pythonExe = path.join(pythonDir, "bin", "python3")
  const archivePath = path.join(cacheDir, linuxPythonArchive)
  const requirementsPath = path.join(input.dependenciesDir, "python-requirements.txt")
  const requirements = Object.entries(PYTHON_PACKAGES)
    .map(([name, version]) => `${name}==${version}`)
    .join("\n")

  await fsp.rm(pythonDir, { recursive: true, force: true })
  await fsp.mkdir(input.dependenciesDir, { recursive: true })
  await downloadVerifiedFile(linuxPythonUrl, archivePath, linuxPythonSha256)
  run("tar", ["-xzf", archivePath, "-C", input.dependenciesDir])

  if (!(await pathExists(pythonExe))) {
    throw new Error(`Linux Python archive did not contain the expected executable: ${pythonExe}`)
  }

  await fsp.chmod(pythonExe, 0o755)
  await fsp.writeFile(requirementsPath, `${requirements}\n`, "utf8")
  await ensurePip(pythonExe, pythonDir)

  console.log(`[desktop][build] installing workspace Python dependencies into ${pythonDir}`)
  installPythonPackages(pythonExe, requirementsPath, pythonDir)
}

function codesignMacBinary(filePath) {
  run("codesign", ["--force", "--sign", "-", filePath])
}

async function patchMacPythonInstallNames(pythonDir) {
  const frameworkRoot = `/Library/Frameworks/Python.framework/Versions/${pythonMajorMinor}`
  const frameworkInstallName = `${frameworkRoot}/Python`
  const pythonLibrary = path.join(pythonDir, "Python")
  const executableNames = ["python3.12", "python3.12-intel64"]
  const patchedBinaries = new Set()

  function changeInstallNameIfPresent(binaryPath, oldName, newName) {
    if (!getOtoolLibraries(binaryPath).includes(oldName)) return
    run("install_name_tool", ["-change", oldName, newName, binaryPath])
    patchedBinaries.add(binaryPath)
  }

  if (await pathExists(pythonLibrary)) {
    run("install_name_tool", ["-id", "@rpath/Python", pythonLibrary])
    patchedBinaries.add(pythonLibrary)
  }

  for (const executableName of executableNames) {
    const executablePath = path.join(pythonDir, "bin", executableName)
    if (!(await pathExists(executablePath))) continue
    changeInstallNameIfPresent(executablePath, frameworkInstallName, "@executable_path/../Python")
  }

  const appStubPath = path.join(pythonDir, "Resources", "Python.app", "Contents", "MacOS", "Python")
  if (await pathExists(appStubPath)) {
    changeInstallNameIfPresent(appStubPath, frameworkInstallName, "@executable_path/../../../../Python")
  }

  const libDir = path.join(pythonDir, "lib")
  const libEntries = await fsp.readdir(libDir, { withFileTypes: true }).catch(() => [])
  const localLibraryNames = libEntries
    .filter((entry) => entry.name.endsWith(".dylib"))
    .map((entry) => entry.name)
  const localLibraryFiles = libEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".dylib"))
    .map((entry) => path.join(libDir, entry.name))

  for (const libraryPath of localLibraryFiles) {
    const libraryName = path.basename(libraryPath)
    run("install_name_tool", ["-id", `@rpath/${libraryName}`, libraryPath])
    patchedBinaries.add(libraryPath)

    for (const dependencyName of localLibraryNames) {
      changeInstallNameIfPresent(
        libraryPath,
        `${frameworkRoot}/lib/${dependencyName}`,
        `@loader_path/${dependencyName}`,
      )
    }
  }

  const libDynloadDir = path.join(libDir, `python${pythonMajorMinor}`, "lib-dynload")
  const extensionPaths = await collectFiles(libDynloadDir, (filePath) => filePath.endsWith(".so"))

  for (const extensionPath of extensionPaths) {
    changeInstallNameIfPresent(extensionPath, frameworkInstallName, "@loader_path/../../../Python")

    for (const dependencyName of localLibraryNames) {
      changeInstallNameIfPresent(
        extensionPath,
        `${frameworkRoot}/lib/${dependencyName}`,
        `@loader_path/../../${dependencyName}`,
      )
    }
  }

  for (const binaryPath of patchedBinaries) {
    codesignMacBinary(binaryPath)
  }
}

async function repairMacPythonSymlinks(pythonDir) {
  const links = [
    ["Headers", "include/python3.12"],
    [path.join("bin", "2to3"), "2to3-3.12"],
    [path.join("bin", "idle3"), "idle3.12"],
    [path.join("bin", "pydoc3"), "pydoc3.12"],
    [path.join("bin", "python3"), "python3.12"],
    [path.join("bin", "python3-config"), "python3.12-config"],
    [path.join("bin", "python3-intel64"), "python3.12-intel64"],
    [path.join("lib", "libpython3.12.dylib"), "../Python"],
    [path.join("lib", "libpanel.dylib"), "libpanel.6.dylib"],
    [path.join("lib", "libcurses.dylib"), "libncurses.6.dylib"],
    [path.join("lib", "libssl.dylib"), "libssl.3.dylib"],
    [path.join("lib", "libform.dylib"), "libform.6.dylib"],
    [path.join("lib", "libcrypto.dylib"), "libcrypto.3.dylib"],
    [path.join("lib", "libncurses.dylib"), "libncurses.6.dylib"],
    [path.join("lib", "libmenu.dylib"), "libmenu.6.dylib"],
    [path.join("lib", "pkgconfig", "python3.pc"), "python-3.12.pc"],
    [path.join("lib", "pkgconfig", "python3-embed.pc"), "python-3.12-embed.pc"],
    [path.join("lib", "python3.12", "config-3.12-darwin", "libpython3.12.dylib"), "../../../Python"],
    [path.join("lib", "python3.12", "config-3.12-darwin", "libpython3.12.a"), "../../../Python"],
    [path.join("share", "man", "man1", "python3.1"), "python3.12.1"],
  ]

  for (const [linkPath, target] of links) {
    const absoluteLinkPath = path.join(pythonDir, linkPath)
    await fsp.rm(absoluteLinkPath, { force: true })
    await fsp.symlink(target, absoluteLinkPath)
  }
}

async function prepareMacPythonDependencies(input) {
  if (process.arch !== "arm64" && process.arch !== "x64") {
    throw new Error(`Workspace Python dependencies are not supported on macOS ${process.arch}.`)
  }

  const pythonDir = path.join(input.dependenciesDir, "python")
  const expandedPkgDir = path.join(cacheDir, `${pythonMacPkg}.expanded`)
  const pkgPath = path.join(cacheDir, pythonMacPkg)
  const requirementsPath = path.join(input.dependenciesDir, "python-requirements.txt")
  const requirements = Object.entries(PYTHON_PACKAGES)
    .map(([name, version]) => `${name}==${version}`)
    .join("\n")

  await fsp.rm(pythonDir, { recursive: true, force: true })
  await fsp.mkdir(input.dependenciesDir, { recursive: true })
  await downloadFile(pythonMacPkgUrl, pkgPath)

  if (!(await pathExists(expandedPkgDir))) {
    await fsp.rm(expandedPkgDir, { recursive: true, force: true })
    expandMacPackage(pkgPath, expandedPkgDir)
  }

  const frameworkVersionDir = path.join(
    expandedPkgDir,
    "Python_Framework.pkg",
    "Payload",
    "Versions",
    pythonMajorMinor,
  )
  const packagedPythonExe = path.join(frameworkVersionDir, "bin", "python3")
  if (!(await pathExists(packagedPythonExe))) {
    throw new Error(`Unable to locate Python framework runtime in expanded macOS Python package: ${expandedPkgDir}`)
  }

  await fsp.cp(frameworkVersionDir, pythonDir, { recursive: true, force: true })
  await repairMacPythonSymlinks(pythonDir)
  await fsp.chmod(path.join(pythonDir, "bin", "python3"), 0o755).catch(() => {})
  await patchMacPythonInstallNames(pythonDir)
  await fsp.writeFile(requirementsPath, `${requirements}\n`, "utf8")

  const pythonExe = path.join(pythonDir, "bin", "python3")
  await ensurePip(pythonExe, pythonDir)

  console.log(`[desktop][build] installing workspace Python dependencies into ${pythonDir}`)
  installPythonPackages(pythonExe, requirementsPath, pythonDir)
}

async function writeManifest(input) {
  await writeJson(path.join(input.dependenciesDir, "manifest.json"), {
    kind: "anybox-workspace-dependencies",
    version: 1,
    bundleVersion,
    platform: process.platform,
    arch: process.arch,
    generatedAt: new Date().toISOString(),
    pythonVersion,
    pythonDistribution: process.platform === "linux" ? LINUX_PYTHON_DISTRIBUTION : undefined,
    nodePackages: NODE_PACKAGES,
    pythonPackages: PYTHON_PACKAGES,
  })
}

export async function prepareWorkspaceDependencies(options = {}) {
  const input = {
    bunBinary: options.bunBinary,
    dependenciesDir: options.dependenciesDir ?? dependenciesDir,
  }

  if (!input.bunBinary) {
    throw new Error("prepareWorkspaceDependencies requires a bunBinary option.")
  }

  await fsp.rm(input.dependenciesDir, { recursive: true, force: true })
  await fsp.mkdir(input.dependenciesDir, { recursive: true })

  await prepareNodeDependencies(input)
  await preparePythonDependencies(input)
  await writeManifest(input)

  console.log(`[desktop][build] prepared workspace dependencies at ${input.dependenciesDir}`)
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const explicitBunBinary = readEnv("ANYBOX_BUN_BINARY")
  if (!explicitBunBinary || !fs.existsSync(explicitBunBinary)) {
    throw new Error("Set ANYBOX_BUN_BINARY to run this script directly.")
  }
  await prepareWorkspaceDependencies({ bunBinary: explicitBunBinary })
}
