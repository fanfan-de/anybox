import fs from "node:fs/promises"
import path from "node:path"

const packageDirectory = path.resolve(import.meta.dirname, "..")
const workspaceDirectory = path.resolve(packageDirectory, "..", "..")
const manifestPath = path.join(
  packageDirectory,
  "src",
  "shared",
  "appearance-token-manifest.json",
)
const catalogPath = path.join(
  workspaceDirectory,
  "docs",
  "desktop-semantic-token-catalog.md",
)
const checkOnly = process.argv.includes("--check")

function fail(message) {
  throw new Error(`Semantic token catalog: ${message}`)
}

function escapeTableCell(value) {
  return String(value ?? "")
    .replaceAll("|", "\\|")
    .replaceAll(/\r?\n/g, " ")
}

function assertUnique(values, label) {
  const seen = new Set()
  for (const value of values) {
    if (seen.has(value)) {
      fail(`duplicate ${label} "--${value}".`)
    }
    seen.add(value)
  }
}

function formatLiteral(value) {
  const hex = value?.value?.hex
  const alpha = value?.value?.alpha
  if (typeof hex !== "string" || typeof alpha !== "number") {
    fail("literal values must include value.hex and value.alpha.")
  }
  return alpha === 1 ? `\`${hex}\`` : `\`${hex}\` · α ${alpha}`
}

function resolveLiteral(tokenName, readDefaultValue, stack = []) {
  if (stack.includes(tokenName)) {
    fail(`alias cycle detected: ${[...stack, tokenName].join(" -> ")}.`)
  }

  const value = readDefaultValue(tokenName)
  if (!value) {
    fail(`default theme cannot resolve "--${tokenName}".`)
  }
  if (value.type === "literal") {
    return value
  }
  if (value.type === "alias") {
    return resolveLiteral(value.token, readDefaultValue, [...stack, tokenName])
  }
  if (value.kind === "blend") {
    return undefined
  }

  fail(`unsupported value type for "--${tokenName}".`)
}

function formatSourceValue(value) {
  if (value.type === "literal") {
    return formatLiteral(value)
  }
  if (value.type === "alias") {
    return `\`--${value.token}\``
  }
  fail("blend sources must be literal or alias values.")
}

function formatDefinition(tokenName, readDefaultValue) {
  const value = readDefaultValue(tokenName)
  if (!value) {
    fail(`default theme is missing "--${tokenName}".`)
  }
  if (value.type === "literal") {
    return formatLiteral(value)
  }
  if (value.type === "alias") {
    const resolvedValue = resolveLiteral(tokenName, readDefaultValue)
    const resolved = resolvedValue
      ? `<br>resolved ${formatLiteral(resolvedValue)}`
      : ""
    return `→ \`--${value.token}\`${resolved}`
  }
  if (value.kind === "blend") {
    const sources = value.sources
      .map(
        (source) =>
          `${source.weight}% ${formatSourceValue(source.value)}`,
      )
      .join(" + ")
    return `blend · ${sources}`
  }

  fail(`unsupported value type for "--${tokenName}".`)
}

function renderCatalog(manifest) {
  if (!Array.isArray(manifest.groups)) {
    fail("manifest.groups must be an array.")
  }
  if (!Array.isArray(manifest.themes)) {
    fail("manifest.themes must be an array.")
  }

  const semanticGroups = manifest.groups
    .map((group) => ({
      ...group,
      rows: group.rows.filter((row) =>
        row.runtimeToken.startsWith("semantic-"),
      ),
    }))
    .filter((group) => group.rows.length > 0)
  const semanticRows = semanticGroups.flatMap((group) => group.rows)

  for (const row of semanticRows) {
    for (const key of ["runtimeToken", "lightToken", "darkToken"]) {
      if (typeof row[key] !== "string" || !row[key]) {
        fail(`row "${row.id}" is missing ${key}.`)
      }
    }
  }

  assertUnique(
    semanticRows.map((row) => row.runtimeToken),
    "runtime token",
  )
  assertUnique(
    semanticRows.map((row) => row.lightToken),
    "light token",
  )
  assertUnique(
    semanticRows.map((row) => row.darkToken),
    "dark token",
  )

  const defaultTheme = manifest.themes.find(
    (theme) => theme.id === manifest.defaultThemeId,
  )
  if (!defaultTheme) {
    fail(`default theme "${manifest.defaultThemeId}" does not exist.`)
  }
  const defaultBrand = manifest.brands?.[defaultTheme.brandTheme]
  if (!defaultBrand?.tokens) {
    fail(`default brand "${defaultTheme.brandTheme}" does not exist.`)
  }
  const readDefaultValue = (tokenName) =>
    defaultTheme.overrides[tokenName] ??
    defaultBrand.tokens[tokenName] ??
    manifest.derivations[tokenName]

  const modeTokenNames = semanticRows.flatMap((row) => [
    row.lightToken,
    row.darkToken,
  ])
  const aliasCount = modeTokenNames.filter(
    (tokenName) => readDefaultValue(tokenName)?.type === "alias",
  ).length
  const literalCount = modeTokenNames.filter(
    (tokenName) => readDefaultValue(tokenName)?.type === "literal",
  ).length
  const derivationCount = modeTokenNames.filter(
    (tokenName) => readDefaultValue(tokenName)?.kind === "blend",
  ).length
  if (aliasCount + literalCount + derivationCount !== modeTokenNames.length) {
    fail("one or more semantic mode tokens have no default definition.")
  }

  const lines = [
    "<!-- Generated by packages/desktop/scripts/generate-semantic-token-catalog.mjs. -->",
    "",
    "# Anybox 桌面端 Semantic Token 清单（当前实现）",
    "",
    `状态：由 \`packages/desktop/src/shared/appearance-token-manifest.json\` 生成的当前实现快照`,
    "",
    "## 1. 范围",
    "",
    "本文列出 manifest 中所有 `runtimeToken` 以 `semantic-` 开头的 token。每一行代表一个语义角色，并同时列出组件实际消费的运行时 token，以及对应的 light/dark mode token。",
    "",
    `- Semantic 角色：${semanticRows.length} 个`,
    `- Light/dark mode token：${modeTokenNames.length} 个`,
    `- 表格覆盖的 CSS 自定义属性总数：${semanticRows.length + modeTokenNames.length} 个`,
    `- 所属 manifest 分组：${semanticGroups.length} 个`,
    "",
    "不包含 foundation token（`surface-*`、`text-*`、`border-*`、`brand-*`）、不以 `semantic-` 开头的全局交互 token、内部 derivation 和 compatibility token。本文只记录现状，不代表这些 token 的命名、暴露等级或复用关系已经通过治理审阅。",
    "",
    "治理规范中提出、但尚未进入 manifest 的候选 token（例如 `semantic-management-leading-icon-*`）也不计入本表。",
    "",
    "## 2. 阅读说明",
    "",
    "| 列 | 含义 |",
    "| --- | --- |",
    "| Runtime token | 组件 CSS 应消费的不带模式后缀的 token |",
    "| Light token / Dark token | 亮色或暗色主题对应的公开 mode token |",
    `| 默认定义 | 当前默认主题 \`${defaultTheme.id}\` / \`${defaultTheme.brandTheme}\` 中的直接定义及解析值 |`,
    "| Layer / Group | manifest 当前归属，不等同于治理规范中的最终层级 |",
    "",
    "## 3. 完整清单",
    "",
  ]

  let rowNumber = 0
  for (const group of semanticGroups) {
    lines.push(
      `### ${escapeTableCell(group.label)}（${group.rows.length}）`,
      "",
      `Layer：\`${group.layer}\`　Group：\`${group.id}\``,
      "",
      "| # | 名称 | Runtime token | Light token | Light 默认定义 | Dark token | Dark 默认定义 | 当前说明 |",
      "| ---: | --- | --- | --- | --- | --- | --- | --- |",
    )

    for (const row of group.rows) {
      rowNumber += 1
      lines.push(
        `| ${rowNumber} | ${escapeTableCell(row.label)} | \`--${row.runtimeToken}\` | \`--${row.lightToken}\` | ${formatDefinition(row.lightToken, readDefaultValue)} | \`--${row.darkToken}\` | ${formatDefinition(row.darkToken, readDefaultValue)} | ${escapeTableCell(row.description)} |`,
      )
    }
    lines.push("")
  }

  const globalInteractionGroup = manifest.groups.find(
    (group) => group.id === "global-interaction",
  )
  if (globalInteractionGroup?.rows?.length) {
    lines.push(
      "## 4. 不在 `semantic-*` 命名空间中的全局交互角色",
      "",
      "以下 token 具有全局交互职责，但当前名称不以 `semantic-` 开头，因此不计入上面的 195 个 Semantic 角色。",
      "",
      "| 名称 | Runtime token | Light token | Dark token | 当前说明 |",
      "| --- | --- | --- | --- | --- |",
    )
    for (const row of globalInteractionGroup.rows) {
      lines.push(
        `| ${escapeTableCell(row.label)} | \`--${row.runtimeToken}\` | \`--${row.lightToken}\` | \`--${row.darkToken}\` | ${escapeTableCell(row.description)} |`,
      )
    }
    lines.push("")
  }

  lines.push(
    "## 5. 范围校验",
    "",
    "| 校验项 | 结果 |",
    "| --- | ---: |",
    `| 表格行数 | ${rowNumber} |`,
    `| 唯一 Runtime token | ${new Set(semanticRows.map((row) => row.runtimeToken)).size} |`,
    `| 唯一 Light token | ${new Set(semanticRows.map((row) => row.lightToken)).size} |`,
    `| 唯一 Dark token | ${new Set(semanticRows.map((row) => row.darkToken)).size} |`,
    `| 默认定义为 alias | ${aliasCount} |`,
    `| 默认定义为 literal | ${literalCount} |`,
    `| 默认定义为 derivation | ${derivationCount} |`,
    "| Runtime / Light / Dark 缺失 | 0 |",
    "",
    "下一步审计应在独立文档中为每一行补充消费者、暴露等级以及 `keep / promote / merge / internalize / deprecate / remove` 结论。本表的默认定义可以直接用于发现 alias coupling，但默认值相同本身不构成合并依据。",
    "",
  )

  return `${lines.join("\n")}\n`
}

const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"))
const catalog = renderCatalog(manifest)

if (checkOnly) {
  let existingCatalog
  try {
    existingCatalog = await fs.readFile(catalogPath, "utf8")
  } catch {
    fail(
      `missing ${path.relative(workspaceDirectory, catalogPath)}; run "npm run appearance:tokens:catalog".`,
    )
  }
  if (existingCatalog !== catalog) {
    fail(
      `${path.relative(workspaceDirectory, catalogPath)} is stale; run "npm run appearance:tokens:catalog".`,
    )
  }
  process.stdout.write(
    `Semantic token catalog is current (${semanticRowsSummary(manifest)}).\n`,
  )
} else {
  await fs.writeFile(catalogPath, catalog, "utf8")
  process.stdout.write(
    `Generated ${path.relative(workspaceDirectory, catalogPath)} (${semanticRowsSummary(manifest)}).\n`,
  )
}

function semanticRowsSummary(currentManifest) {
  const semanticRoleCount = currentManifest.groups
    .flatMap((group) => group.rows)
    .filter((row) => row.runtimeToken.startsWith("semantic-")).length
  return `${semanticRoleCount} semantic roles`
}
