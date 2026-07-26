import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  resolveSemanticTokenSourcePath,
  SemanticTokenAuthoringService,
  type SemanticTokenAuthoringOpaqueReference,
} from "./semantic-token-authoring"

const literalWhite = {
  type: "literal",
  value: {
    colorSpace: "srgb",
    components: [1, 1, 1],
    alpha: 1,
    hex: "#ffffff",
  },
}

const literalBlack = {
  type: "literal",
  value: {
    colorSpace: "srgb",
    components: [0, 0, 0],
    alpha: 1,
    hex: "#000000",
  },
}

function manifestDocument() {
  return {
    schemaVersion: 2,
    defaultThemeId: "built-in:classic",
    layers: ["foundation", "component", "product", "status", "global"],
    groups: [
      {
        id: "buttons",
        layer: "component",
        label: "Buttons",
        description: "Button colors.",
        rows: [
          {
            id: "semantic-button-surface",
            label: "Button Surface",
            description: "Button surface.",
            lightToken: "semantic-button-surface-light",
            darkToken: "semantic-button-surface-dark",
            runtimeToken: "semantic-button-surface",
          },
        ],
      },
    ],
    brands: {
      terra: {
        label: "Terra",
        tokens: {
          "semantic-button-surface-light": literalWhite,
          "semantic-button-surface-dark": literalBlack,
        },
      },
    },
    themes: [
      {
        id: "built-in:classic",
        name: "Classic",
        colorMode: "light",
        brandTheme: "terra",
        fontFamily: "default",
        codeThemePreference: "auto",
        htmlBackgroundConfig: {},
        overrides: {},
      },
    ],
  }
}

async function createFixture() {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "anybox-semantic-authoring-"))
  const packageRoot = path.join(workspaceRoot, "packages", "desktop")
  const rendererRoot = path.join(packageRoot, "src", "renderer", "src")
  const stylesRoot = path.join(rendererRoot, "styles")
  const sharedRoot = path.join(packageRoot, "src", "shared")
  const scriptsRoot = path.join(packageRoot, "scripts")
  const docsRoot = path.join(workspaceRoot, "docs")
  await Promise.all([
    mkdir(stylesRoot, { recursive: true }),
    mkdir(sharedRoot, { recursive: true }),
    mkdir(scriptsRoot, { recursive: true }),
    mkdir(docsRoot, { recursive: true }),
  ])
  const manifestPath = path.join(sharedRoot, "appearance-token-manifest.json")
  const cssPath = path.join(stylesRoot, "sample.css")
  await writeFile(manifestPath, `${JSON.stringify(manifestDocument(), null, 2)}\n`, "utf8")
  await writeFile(
    cssPath,
    [
      ".button {",
      "  border: 1px solid #111111;",
      "  color: #111111 !important;",
      "}",
      "",
    ].join("\n"),
    "utf8",
  )
  return {
    workspaceRoot,
    packageRoot,
    rendererRoot,
    manifestPath,
    cssPath,
    scriptsRoot,
    docsRoot,
  }
}

describe("semantic token authoring source mapping", () => {
  const temporaryRoots: string[] = []

  afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ))
  })

  it("maps Vite, /@fs, and file URLs and rejects traversal/external/generated sources", async () => {
    const fixture = await createFixture()
    temporaryRoots.push(fixture.workspaceRoot)
    const outsidePath = path.join(fixture.packageRoot, "outside.css")
    const generatedPath = path.join(
      fixture.rendererRoot,
      "styles",
      "appearance-tokens.generated.css",
    )
    await writeFile(outsidePath, ".outside {}", "utf8")
    await writeFile(generatedPath, ":root {}", "utf8")

    expect(resolveSemanticTokenSourcePath(
      "http://127.0.0.1:5173/src/styles/sample.css?t=1",
      fixture.rendererRoot,
    )).toBe(path.resolve(fixture.cssPath))
    expect(resolveSemanticTokenSourcePath(
      `http://127.0.0.1:5173/@fs/${fixture.cssPath.replaceAll("\\", "/")}`,
      fixture.rendererRoot,
    )).toBe(path.resolve(fixture.cssPath))
    expect(resolveSemanticTokenSourcePath(
      new URL(`file:///${fixture.cssPath.replaceAll("\\", "/")}`).toString(),
      fixture.rendererRoot,
    )).toBe(path.resolve(fixture.cssPath))
    expect(resolveSemanticTokenSourcePath(
      "/src/styles/sample.css?t=2",
      fixture.rendererRoot,
    )).toBe(path.resolve(fixture.cssPath))
    expect(resolveSemanticTokenSourcePath(
      fixture.cssPath,
      fixture.rendererRoot,
    )).toBe(path.resolve(fixture.cssPath))
    expect(resolveSemanticTokenSourcePath(
      `/${fixture.cssPath.replaceAll("\\", "/")}?direct`,
      fixture.rendererRoot,
    )).toBe(path.resolve(fixture.cssPath))
    expect(resolveSemanticTokenSourcePath(
      "http://127.0.0.1:5173/src/../../outside.css",
      fixture.rendererRoot,
    )).toBeNull()
    expect(resolveSemanticTokenSourcePath(
      "http://127.0.0.1:5173/src/styles/appearance-tokens.generated.css",
      fixture.rendererRoot,
    )).toBeNull()
  })
})

describe("SemanticTokenAuthoringService", () => {
  const temporaryRoots: string[] = []

  afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ))
  })

  it("prepares and commits exact declarations and safe shorthand longhands", async () => {
    const fixture = await createFixture()
    temporaryRoots.push(fixture.workspaceRoot)
    const service = new SemanticTokenAuthoringService({
      packageRoot: fixture.packageRoot,
      rendererSourceRoot: fixture.rendererRoot,
      packaged: false,
    })
    const references = new Map<string, SemanticTokenAuthoringOpaqueReference>([
      ["color-ref", {
        kind: "declaration",
        filePath: fixture.cssPath,
        selector: ".button",
        ruleLine: 1,
        declarationLine: 3,
        authoredProperty: "color",
        originalValue: "#111111",
        important: true,
      }],
      ["border-ref", {
        kind: "declaration",
        filePath: fixture.cssPath,
        selector: ".button",
        ruleLine: 1,
        declarationLine: 2,
        authoredProperty: "border",
        originalValue: "1px solid #111111",
        important: false,
      }],
    ])

    const prepared = await service.prepare("session-1", {
      version: 1,
      sourceThemeID: "built-in:classic",
      operations: [
        {
          kind: "binding-edit",
          channelID: "color",
          cssProperty: "color",
          runtimeToken: "semantic-button-surface",
          editRef: "color-ref",
          selector: ".button",
          sourceLabel: "sample.css",
        },
        {
          kind: "binding-edit",
          channelID: "border-color",
          cssProperty: "border-color",
          runtimeToken: "semantic-button-surface",
          editRef: "border-ref",
          selector: ".button",
          sourceLabel: "sample.css",
        },
      ],
    }, references)
    expect(prepared.status).toBe("prepared")
    if (prepared.status !== "prepared") return
    expect(prepared.files[0].diff).toContain("color: var(--semantic-button-surface) !important")
    expect(prepared.files[0].diff).toContain("border-color: var(--semantic-button-surface)")

    await expect(service.commit("session-1", prepared.transactionID)).resolves.toMatchObject({
      status: "committed",
      verification: "pending-hmr",
    })
    const css = await readFile(fixture.cssPath, "utf8")
    expect(css).toContain("border: 1px solid #111111;")
    expect(css).toContain("border-color: var(--semantic-button-surface);")
    expect(css).toContain("color: var(--semantic-button-surface) !important;")
  })

  it("returns stale without overwriting a file changed after prepare", async () => {
    const fixture = await createFixture()
    temporaryRoots.push(fixture.workspaceRoot)
    const service = new SemanticTokenAuthoringService({
      packageRoot: fixture.packageRoot,
      rendererSourceRoot: fixture.rendererRoot,
      packaged: false,
    })
    const references = new Map<string, SemanticTokenAuthoringOpaqueReference>([
      ["rule-ref", {
        kind: "rule",
        filePath: fixture.cssPath,
        selector: ".button",
        ruleLine: 1,
      }],
    ])
    const prepared = await service.prepare("session-2", {
      version: 1,
      sourceThemeID: "built-in:classic",
      operations: [{
        kind: "binding-edit",
        channelID: "background-color",
        cssProperty: "background-color",
        runtimeToken: "semantic-button-surface",
        ruleRef: "rule-ref",
        selector: ".button",
        sourceLabel: "sample.css",
      }],
    }, references)
    expect(prepared.status).toBe("prepared")
    if (prepared.status !== "prepared") return
    await writeFile(fixture.cssPath, ".button { color: hotpink; }\n", "utf8")

    await expect(service.commit("session-2", prepared.transactionID)).resolves.toMatchObject({
      status: "stale",
      files: ["src/renderer/src/styles/sample.css"],
    })
    await expect(readFile(fixture.cssPath, "utf8")).resolves.toContain("hotpink")
  })

  it("returns stale when a generated file changes during review", async () => {
    const fixture = await createFixture()
    temporaryRoots.push(fixture.workspaceRoot)
    const generatedTs = path.join(
      fixture.packageRoot,
      "src",
      "shared",
      "appearance-tokens.generated.ts",
    )
    const generatedCss = path.join(
      fixture.packageRoot,
      "src",
      "renderer",
      "src",
      "styles",
      "appearance-tokens.generated.css",
    )
    const catalog = path.join(fixture.docsRoot, "desktop-semantic-token-catalog.md")
    await writeFile(generatedTs, "generated ts before review\n", "utf8")
    await writeFile(generatedCss, "generated css before review\n", "utf8")
    await writeFile(catalog, "catalog before review\n", "utf8")
    const service = new SemanticTokenAuthoringService({
      packageRoot: fixture.packageRoot,
      rendererSourceRoot: fixture.rendererRoot,
      packaged: false,
    })
    const prepared = await service.prepare("session-generated-stale", {
      version: 1,
      sourceThemeID: "built-in:classic",
      operations: [{
        kind: "theme-token-value-edit",
        runtimeToken: "semantic-button-surface",
        mode: "light",
        action: "set",
        value: "#eeeeee",
      }],
    }, new Map())
    expect(prepared.status).toBe("prepared")
    if (prepared.status !== "prepared") return
    await writeFile(catalog, "catalog changed during review\n", "utf8")

    await expect(
      service.commit("session-generated-stale", prepared.transactionID),
    ).resolves.toMatchObject({
      status: "stale",
      files: ["../../docs/desktop-semantic-token-catalog.md"],
    })
    await expect(readFile(fixture.manifestPath, "utf8")).resolves.not.toContain("#eeeeee")
  })

  it("writes a new token through JSONC, runs generators, and reports generated files", async () => {
    const fixture = await createFixture()
    temporaryRoots.push(fixture.workspaceRoot)
    const generatedTs = path.join(fixture.packageRoot, "src", "shared", "appearance-tokens.generated.ts")
    const generatedCss = path.join(
      fixture.packageRoot,
      "src",
      "renderer",
      "src",
      "styles",
      "appearance-tokens.generated.css",
    )
    const catalog = path.join(fixture.docsRoot, "desktop-semantic-token-catalog.md")
    await writeFile(generatedTs, "old generated ts\n", "utf8")
    await writeFile(generatedCss, "old generated css\n", "utf8")
    await writeFile(catalog, "old catalog\n", "utf8")
    await writeFile(
      path.join(fixture.scriptsRoot, "generate-appearance-tokens.mjs"),
      [
        'import fs from "node:fs/promises"',
        'await fs.writeFile(new URL("../src/shared/appearance-tokens.generated.ts", import.meta.url), "new generated ts\\n")',
        'await fs.writeFile(new URL("../src/renderer/src/styles/appearance-tokens.generated.css", import.meta.url), "new generated css\\n")',
      ].join("\n"),
      "utf8",
    )
    await writeFile(
      path.join(fixture.scriptsRoot, "generate-semantic-token-catalog.mjs"),
      [
        'import fs from "node:fs/promises"',
        'await fs.writeFile(new URL("../../../docs/desktop-semantic-token-catalog.md", import.meta.url), "new catalog\\n")',
      ].join("\n"),
      "utf8",
    )
    const service = new SemanticTokenAuthoringService({
      packageRoot: fixture.packageRoot,
      rendererSourceRoot: fixture.rendererRoot,
      packaged: false,
    })

    const prepared = await service.prepare("session-3", {
      version: 1,
      sourceThemeID: "built-in:classic",
      operations: [{
        kind: "token-creation",
        runtimeToken: "semantic-button-custom-surface",
        groupID: "buttons",
        createGroup: false,
        layer: "component",
        label: "Custom Button Surface",
        description: "A custom button surface.",
        light: {
          value: "#fefefe",
          baseAlias: "semantic-button-surface-light",
        },
        dark: {
          value: "#121212",
          baseAlias: "semantic-button-surface-dark",
        },
      }],
    }, new Map())
    expect(prepared.status).toBe("prepared")
    if (prepared.status !== "prepared") return
    expect(prepared.summary).toMatchObject({ tokenCreations: 1 })
    expect(prepared.files.some((file) => file.kind === "generated")).toBe(true)

    await expect(service.commit("session-3", prepared.transactionID)).resolves.toMatchObject({
      status: "committed",
    })
    const manifest = await readFile(fixture.manifestPath, "utf8")
    expect(manifest).toContain('"runtimeToken": "semantic-button-custom-surface"')
    expect(manifest).toContain('"semantic-button-custom-surface-light"')
    expect(await readFile(generatedTs, "utf8")).toBe("new generated ts\n")
    expect(await readFile(generatedCss, "utf8")).toBe("new generated css\n")
    expect(await readFile(catalog, "utf8")).toBe("new catalog\n")
  })

  it("rolls back manifest and generated snapshots when generation fails", async () => {
    const fixture = await createFixture()
    temporaryRoots.push(fixture.workspaceRoot)
    const generatedTs = path.join(fixture.packageRoot, "src", "shared", "appearance-tokens.generated.ts")
    const generatedCss = path.join(
      fixture.packageRoot,
      "src",
      "renderer",
      "src",
      "styles",
      "appearance-tokens.generated.css",
    )
    const catalog = path.join(fixture.docsRoot, "desktop-semantic-token-catalog.md")
    await writeFile(generatedTs, "old generated ts\n", "utf8")
    await writeFile(generatedCss, "old generated css\n", "utf8")
    await writeFile(catalog, "old catalog\n", "utf8")
    const originalManifest = await readFile(fixture.manifestPath, "utf8")
    await writeFile(
      path.join(fixture.scriptsRoot, "generate-appearance-tokens.mjs"),
      [
        'import fs from "node:fs/promises"',
        'await fs.writeFile(new URL("../src/shared/appearance-tokens.generated.ts", import.meta.url), "partial\\n")',
        'throw new Error("generator failed")',
      ].join("\n"),
      "utf8",
    )
    const service = new SemanticTokenAuthoringService({
      packageRoot: fixture.packageRoot,
      rendererSourceRoot: fixture.rendererRoot,
      packaged: false,
    })
    const prepared = await service.prepare("session-4", {
      version: 1,
      sourceThemeID: "built-in:classic",
      operations: [{
        kind: "theme-token-value-edit",
        runtimeToken: "semantic-button-surface",
        mode: "light",
        action: "set",
        value: "#eeeeee",
      }],
    }, new Map())
    expect(prepared.status).toBe("prepared")
    if (prepared.status !== "prepared") return

    await expect(service.commit("session-4", prepared.transactionID)).resolves.toMatchObject({
      status: "failed",
      rolledBack: true,
    })
    expect(await readFile(fixture.manifestPath, "utf8")).toBe(originalManifest)
    expect(await readFile(generatedTs, "utf8")).toBe("old generated ts\n")
    expect(await readFile(generatedCss, "utf8")).toBe("old generated css\n")
    expect(await readFile(catalog, "utf8")).toBe("old catalog\n")
  })

  it("keeps authoring unavailable in packaged mode", async () => {
    const fixture = await createFixture()
    temporaryRoots.push(fixture.workspaceRoot)
    const service = new SemanticTokenAuthoringService({
      packageRoot: fixture.packageRoot,
      rendererSourceRoot: fixture.rendererRoot,
      packaged: true,
    })
    expect(service.available).toBe(false)
    await expect(service.prepare("session-5", {
      version: 1,
      sourceThemeID: "built-in:classic",
      operations: [],
    }, new Map())).resolves.toMatchObject({ status: "unavailable" })
  })
})
