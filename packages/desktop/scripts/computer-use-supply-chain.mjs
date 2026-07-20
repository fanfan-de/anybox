import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import fs from "node:fs"
import fsp from "node:fs/promises"
import path from "node:path"

const SHA256_PATTERN = /^[a-f0-9]{64}$/
const COMPONENT_NAME = "anybox-computer-use-windows"
const BUILD_TYPE = "https://anybox.dev/build-types/computer-use-runtime/v1"
const BUILDER_ID =
  "https://github.com/fanfan-de/anybox/packages/desktop/scripts/prepare-agent-runtime.mjs"

function invariant(condition, message) {
  if (!condition) throw new Error(message)
}

function portablePath(value) {
  return value.split(path.sep).join("/")
}

async function sha256(filePath) {
  const hash = createHash("sha256")
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk)
  return hash.digest("hex")
}

async function listFiles(directory) {
  const entries = await fsp.readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await listFiles(entryPath))
    if (entry.isFile()) files.push(entryPath)
  }
  return files
}

async function describeFile(root, relativePath) {
  const absolutePath = path.join(root, relativePath)
  const stat = await fsp.stat(absolutePath)
  invariant(stat.isFile(), `Computer Use artifact is not a file: ${relativePath}`)
  return {
    name: portablePath(relativePath),
    sizeBytes: stat.size,
    sha256: await sha256(absolutePath),
  }
}

function readBuildInfo(sourceRoot) {
  const source = fs.readFileSync(
    path.join(sourceRoot, "helper", "ComputerUse.Helper", "BuildInfo.cs"),
    "utf8",
  )
  const helperVersion = source.match(/HelperVersion\s*=\s*"([^"]+)"/)?.[1]
  const protocolVersion = Number(source.match(/ProtocolVersion\s*=\s*(\d+)/)?.[1])
  invariant(helperVersion, "Computer Use BuildInfo.cs has no helper version")
  invariant(
    Number.isSafeInteger(protocolVersion) && protocolVersion > 0,
    "Computer Use BuildInfo.cs has no valid protocol version",
  )
  return { helperVersion, protocolVersion }
}

function gitProvenance(repoRoot) {
  const revision = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
    windowsHide: true,
  })
  const status = spawnSync("git", ["status", "--porcelain"], {
    cwd: repoRoot,
    encoding: "utf8",
    windowsHide: true,
  })
  return {
    revision:
      revision.status === 0 && /^[a-f0-9]{40}$/i.test(revision.stdout.trim())
        ? revision.stdout.trim().toLowerCase()
        : "unknown",
    dirty: status.status !== 0 || status.stdout.trim().length > 0,
  }
}

export function windowsAuthenticodeStatus(helperPath) {
  if (process.platform !== "win32") return "NotApplicable"
  const command = [
    "$ErrorActionPreference='Stop'",
    "(Get-AuthenticodeSignature -LiteralPath $env:ANYBOX_CU_HELPER_PATH).Status.ToString()",
  ].join(";")
  const baseEnvironment = {
    ...process.env,
    ANYBOX_CU_HELPER_PATH: helperPath,
  }
  const legacyModulePath = process.env.PSModulePath
    ?.split(path.delimiter)
    .filter((entry) =>
      /(?:^|[\\/])WindowsPowerShell(?:[\\/]|$)|WindowsPowerShell[\\/]v1\.0/i
        .test(entry)
    )
    .join(path.delimiter)
  for (const [shell, environment] of [
    ["pwsh.exe", baseEnvironment],
    [
      "powershell.exe",
      {
        ...baseEnvironment,
        ...(legacyModulePath ? { PSModulePath: legacyModulePath } : {}),
      },
    ],
  ]) {
    const result = spawnSync(
      shell,
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
      {
        encoding: "utf8",
        windowsHide: true,
        env: environment,
      },
    )
    const status = result.status === 0
      ? result.stdout.trim().split(/\r?\n/).at(-1)
      : undefined
    if (status && /^[A-Za-z]+$/.test(status)) return status
  }
  return "Unavailable"
}

async function sourceMaterials(repoRoot, sourceRoot) {
  const candidates = [
    path.join(sourceRoot, ".anybox-plugin", "plugin.json"),
    path.join(sourceRoot, "helper", "ComputerUse.Helper", "BuildInfo.cs"),
    path.join(sourceRoot, "helper", "ComputerUse.Helper", "ComputerUse.Helper.csproj"),
    path.join(sourceRoot, "scripts", "server.js"),
    path.join(sourceRoot, "scripts", "computer-use-client.mjs"),
    path.join(sourceRoot, "skills", "computer-use", "SKILL.md"),
    ...await listFiles(path.join(sourceRoot, "docs")),
    path.join(repoRoot, "packages", "anyboxagent", "src", "mcp", "builtin.ts"),
    path.join(repoRoot, "packages", "anyboxagent", "src", "mcp", "manager.ts"),
    path.join(repoRoot, "packages", "anyboxagent", "src", "permission", "permission.ts"),
    path.join(repoRoot, "packages", "anyboxagent", "src", "permission", "schema.ts"),
    path.join(repoRoot, "packages", "desktop", "scripts", "prepare-agent-runtime.mjs"),
    path.join(repoRoot, "packages", "desktop", "scripts", "computer-use-supply-chain.mjs"),
    ...await listFiles(path.join(sourceRoot, "scripts", "lib")),
    ...await listFiles(
      path.join(repoRoot, "packages", "anyboxagent", "src", "mcp", "computer-use"),
    ),
  ]
  const unique = [...new Set(candidates.map((value) => path.resolve(value)))].sort()
  return await Promise.all(unique.map(async (absolutePath) => ({
    uri: `file:${portablePath(path.relative(repoRoot, absolutePath))}`,
    digest: { sha256: await sha256(absolutePath) },
  })))
}

export async function writeComputerUseSupplyChainMetadata({
  runtimeDir,
  repoRoot,
  sourceRoot,
  platform = process.platform,
  arch = process.arch,
}) {
  if (platform !== "win32") return undefined

  const plugin = JSON.parse(fs.readFileSync(
    path.join(sourceRoot, ".anybox-plugin", "plugin.json"),
    "utf8",
  ))
  const buildInfo = readBuildInfo(sourceRoot)
  invariant(
    plugin.version === buildInfo.helperVersion,
    "Computer Use plugin and helper versions do not match",
  )

  const facadeRoot = path.join(runtimeDir, "mcp", "computer-use")
  const artifactPaths = [
    "agent-server.js",
    portablePath(path.join("mcp", "computer-use", "server.js")),
    portablePath(path.join("mcp", "computer-use", "package.json")),
    portablePath(path.join(
      "computer-use",
      "win32-x64",
      "computer-use-helper.exe",
    )),
    portablePath(path.join(
      "computer-use",
      "win32-x64",
      "computer-use-helper.sha256",
    )),
    ...(await listFiles(path.join(facadeRoot, "lib"))).map((absolutePath) =>
      portablePath(path.relative(runtimeDir, absolutePath))
    ),
  ].sort()
  const files = await Promise.all(
    [...new Set(artifactPaths)].map((relativePath) =>
      describeFile(runtimeDir, relativePath)
    ),
  )
  const helper = files.find((file) =>
    file.name === "computer-use/win32-x64/computer-use-helper.exe"
  )
  invariant(helper, "Computer Use helper is missing from runtime metadata")
  const helperDigestManifest = fs
    .readFileSync(
      path.join(
        runtimeDir,
        "computer-use",
        "win32-x64",
        "computer-use-helper.sha256",
      ),
      "utf8",
    )
    .trim()
    .toLowerCase()
    .split(/\s+/)[0]
  invariant(
    SHA256_PATTERN.test(helperDigestManifest)
      && helperDigestManifest === helper.sha256,
    "Computer Use helper digest manifest is stale",
  )
  const authenticodeStatus = windowsAuthenticodeStatus(
    path.join(
      runtimeDir,
      "computer-use",
      "win32-x64",
      "computer-use-helper.exe",
    ),
  )
  const git = gitProvenance(repoRoot)
  const materials = await sourceMaterials(repoRoot, sourceRoot)

  const manifest = {
    schemaVersion: 1,
    component: COMPONENT_NAME,
    version: plugin.version,
    helperVersion: buildInfo.helperVersion,
    protocolVersion: buildInfo.protocolVersion,
    platform,
    arch,
    authenticodeStatus,
    source: git,
    files,
  }
  const fileComponents = files.map((file) => ({
    type: "file",
    "bom-ref": `file:${file.name}`,
    name: file.name,
    hashes: [{ alg: "SHA-256", content: file.sha256 }],
    properties: [
      { name: "anybox:sizeBytes", value: String(file.sizeBytes) },
    ],
  }))
  const sbom = {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    version: 1,
    metadata: {
      component: {
        type: "application",
        "bom-ref": `pkg:generic/${COMPONENT_NAME}@${plugin.version}`,
        group: "Anybox",
        name: COMPONENT_NAME,
        version: plugin.version,
        licenses: [{ license: { id: "MIT" } }],
        properties: [
          { name: "anybox:platform", value: platform },
          { name: "anybox:arch", value: arch },
          {
            name: "anybox:computerUseProtocolVersion",
            value: String(buildInfo.protocolVersion),
          },
          { name: "anybox:authenticodeStatus", value: authenticodeStatus },
        ],
      },
    },
    components: [
      {
        type: "framework",
        "bom-ref": "pkg:nuget/Microsoft.NETCore.App@9.0",
        name: "Microsoft.NETCore.App",
        version: "9.0",
        purl: "pkg:nuget/Microsoft.NETCore.App@9.0",
      },
      {
        type: "library",
        "bom-ref": "pkg:nuget/Interop.UIAutomationClient@10.19041.0",
        name: "Interop.UIAutomationClient",
        version: "10.19041.0",
        purl: "pkg:nuget/Interop.UIAutomationClient@10.19041.0",
      },
      ...fileComponents,
    ],
    dependencies: [{
      ref: `pkg:generic/${COMPONENT_NAME}@${plugin.version}`,
      dependsOn: [
        "pkg:nuget/Microsoft.NETCore.App@9.0",
        "pkg:nuget/Interop.UIAutomationClient@10.19041.0",
        ...fileComponents.map((component) => component["bom-ref"]),
      ],
    }],
  }
  const provenance = {
    _type: "https://in-toto.io/Statement/v1",
    subject: files.map((file) => ({
      name: file.name,
      digest: { sha256: file.sha256 },
    })),
    predicateType: "https://slsa.dev/provenance/v1",
    predicate: {
      buildDefinition: {
        buildType: BUILD_TYPE,
        externalParameters: {
          platform,
          arch,
          componentVersion: plugin.version,
          protocolVersion: buildInfo.protocolVersion,
        },
        internalParameters: {
          builderScript:
            "packages/desktop/scripts/prepare-agent-runtime.mjs",
          sourceRevision: git.revision,
          sourceTreeDirty: git.dirty,
        },
        resolvedDependencies: materials,
      },
      runDetails: {
        builder: { id: BUILDER_ID },
      },
    },
  }

  const metadataRoot = path.join(runtimeDir, "computer-use")
  await fsp.mkdir(metadataRoot, { recursive: true })
  await fsp.writeFile(
    path.join(metadataRoot, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  )
  await fsp.writeFile(
    path.join(metadataRoot, "sbom.cdx.json"),
    `${JSON.stringify(sbom, null, 2)}\n`,
  )
  await fsp.writeFile(
    path.join(metadataRoot, "provenance.intoto.json"),
    `${JSON.stringify(provenance, null, 2)}\n`,
  )
  return manifest
}

function fileMap(files, label) {
  invariant(Array.isArray(files) && files.length > 0, `${label} has no files`)
  const result = new Map()
  for (const file of files) {
    invariant(
      typeof file?.name === "string"
        && Number.isSafeInteger(file?.sizeBytes)
        && file.sizeBytes >= 0
        && SHA256_PATTERN.test(file?.sha256),
      `${label} has an invalid file entry`,
    )
    invariant(!result.has(file.name), `${label} contains duplicate file ${file.name}`)
    result.set(file.name, file)
  }
  return result
}

export async function verifyComputerUseSupplyChainMetadata({
  runtimeDir,
  platform = process.platform,
  arch = process.arch,
  releaseStrict = false,
}) {
  if (platform !== "win32") return undefined
  const metadataRoot = path.join(runtimeDir, "computer-use")
  const manifest = JSON.parse(await fsp.readFile(
    path.join(metadataRoot, "manifest.json"),
    "utf8",
  ))
  const sbom = JSON.parse(await fsp.readFile(
    path.join(metadataRoot, "sbom.cdx.json"),
    "utf8",
  ))
  const provenance = JSON.parse(await fsp.readFile(
    path.join(metadataRoot, "provenance.intoto.json"),
    "utf8",
  ))

  invariant(manifest.schemaVersion === 1, "Computer Use manifest schema mismatch")
  invariant(manifest.component === COMPONENT_NAME, "Computer Use manifest component mismatch")
  invariant(manifest.platform === platform, "Computer Use manifest platform mismatch")
  invariant(manifest.arch === arch, "Computer Use manifest architecture mismatch")
  invariant(
    manifest.version === manifest.helperVersion,
    "Computer Use manifest version mismatch",
  )
  const files = fileMap(manifest.files, "Computer Use manifest")
  for (const [name, expected] of files) {
    const absolutePath = path.join(runtimeDir, ...name.split("/"))
    invariant(fs.existsSync(absolutePath), `Computer Use artifact is missing: ${name}`)
    const stat = await fsp.stat(absolutePath)
    invariant(stat.size === expected.sizeBytes, `Computer Use artifact size mismatch: ${name}`)
    invariant(
      await sha256(absolutePath) === expected.sha256,
      `Computer Use artifact digest mismatch: ${name}`,
    )
  }

  invariant(sbom.bomFormat === "CycloneDX", "Computer Use SBOM format mismatch")
  invariant(sbom.specVersion === "1.5", "Computer Use SBOM version mismatch")
  invariant(
    sbom.metadata?.component?.version === manifest.version,
    "Computer Use SBOM component version mismatch",
  )
  const sbomFiles = new Map(
    (Array.isArray(sbom.components) ? sbom.components : [])
      .filter((component) => component?.type === "file")
      .map((component) => [
        String(component.name),
        component.hashes?.find((hash) => hash?.alg === "SHA-256")?.content,
      ]),
  )
  invariant(sbomFiles.size === files.size, "Computer Use SBOM file set mismatch")
  for (const [name, expected] of files) {
    invariant(
      sbomFiles.get(name) === expected.sha256,
      `Computer Use SBOM digest mismatch: ${name}`,
    )
  }

  invariant(
    provenance._type === "https://in-toto.io/Statement/v1",
    "Computer Use provenance statement type mismatch",
  )
  invariant(
    provenance.predicateType === "https://slsa.dev/provenance/v1",
    "Computer Use provenance predicate type mismatch",
  )
  invariant(
    provenance.predicate?.buildDefinition?.buildType === BUILD_TYPE,
    "Computer Use provenance build type mismatch",
  )
  invariant(
    provenance.predicate?.runDetails?.builder?.id === BUILDER_ID,
    "Computer Use provenance builder mismatch",
  )
  const subjects = new Map(
    (Array.isArray(provenance.subject) ? provenance.subject : [])
      .map((subject) => [String(subject.name), subject.digest?.sha256]),
  )
  invariant(subjects.size === files.size, "Computer Use provenance subject set mismatch")
  for (const [name, expected] of files) {
    invariant(
      subjects.get(name) === expected.sha256,
      `Computer Use provenance digest mismatch: ${name}`,
    )
  }
  const materials =
    provenance.predicate?.buildDefinition?.resolvedDependencies
  invariant(
    Array.isArray(materials) && materials.length > 0,
    "Computer Use provenance has no source materials",
  )
  for (const material of materials) {
    invariant(
      typeof material?.uri === "string"
        && material.uri.startsWith("file:")
        && SHA256_PATTERN.test(material?.digest?.sha256),
      "Computer Use provenance contains an invalid source material",
    )
  }

  const helperPath = path.join(
    runtimeDir,
    "computer-use",
    "win32-x64",
    "computer-use-helper.exe",
  )
  const authenticodeStatus = windowsAuthenticodeStatus(helperPath)
  invariant(
    authenticodeStatus === manifest.authenticodeStatus,
    "Computer Use Authenticode status changed after metadata generation",
  )
  if (releaseStrict) {
    invariant(
      authenticodeStatus === "Valid",
      `Computer Use helper must have a valid Authenticode signature for release (got ${authenticodeStatus})`,
    )
  }

  return {
    version: manifest.version,
    protocolVersion: manifest.protocolVersion,
    files: files.size,
    authenticodeStatus,
  }
}
