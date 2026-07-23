import { describe, expect, test } from "bun:test"
import "./sqlite.cleanup.ts"
import { $ } from "bun"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import * as Discovery from "#environment/discovery.ts"
import * as EnvironmentManager from "#environment/manager.ts"
import * as Store from "#environment/store.ts"
import {
  EnvironmentDefinition,
  resolveEnvironmentScript,
} from "#environment/types.ts"
import * as Project from "#project/project.ts"
import { ApiError } from "#server/error.ts"

async function createGitRepo(prefix: string) {
  const root = await mkdtemp(path.join(tmpdir(), prefix))
  await writeFile(path.join(root, "README.md"), "# environment test\n")
  await $`git init`.cwd(root).quiet()
  await $`git config user.email test@example.com`.cwd(root).quiet()
  await $`git config user.name anybox-test`.cwd(root).quiet()
  await $`git add README.md`.cwd(root).quiet()
  await $`git commit -m init`.cwd(root).quiet()
  const { project } = await Project.fromDirectory(root)
  return { root, project }
}

async function writeCodexEnvironment(root: string, name = "Codex root") {
  const directory = path.join(root, ".codex", "environments")
  await mkdir(directory, { recursive: true })
  const file = path.join(directory, "environment.toml")
  await writeFile(
    file,
    [
      "version = 1",
      `name = ${JSON.stringify(name)}`,
      "",
      "[[actions]]",
      'name = "Run app"',
      'icon = "play"',
      'command = "npm run dev"',
      "",
    ].join("\n"),
  )
  return file
}

async function writeNativeEnvironment(root: string, name = "Native child") {
  const directory = path.join(root, ".anybox", "environments")
  await mkdir(directory, { recursive: true })
  const file = path.join(directory, "environment.jsonc")
  await writeFile(
    file,
    [
      "{",
      "  // This comment must survive edits.",
      '  "version": 1,',
      `  "name": ${JSON.stringify(name)},`,
      '  "actions": [',
      "    {",
      '      "id": "dev",',
      '      "name": "Run app",',
      '      "icon": "play",',
      '      "scripts": { "default": "npm run dev" },',
      '      "cwd": "."',
      "    }",
      "  ]",
      "}",
      "",
    ].join("\n"),
  )
  return file
}

describe("project environment discovery", () => {
  test("returns direct Anybox JSONC before the nearest parent Codex TOML", async () => {
    const { root, project } = await createGitRepo("anybox-environment-discovery-")
    try {
      await writeCodexEnvironment(root)
      const child = path.join(root, "packages", "app")
      await mkdir(child, { recursive: true })
      await writeNativeEnvironment(child)

      const result = await Discovery.discoverProjectEnvironments(project.id, child)

      expect(result.boundaryRoot).toBe(root)
      expect(result.items.map((item) => [item.source, item.scope])).toEqual([
        ["anybox-jsonc", "direct"],
        ["codex-toml", "ancestor"],
      ])
      expect(result.selectedKey).toBe(result.items[0]?.key)
      expect(result.items[1]?.definition?.actions[0]).toMatchObject({
        id: "run-app",
        name: "Run app",
        scripts: { default: "npm run dev" },
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("invalidates trust after file contents change", async () => {
    const { root, project } = await createGitRepo("anybox-environment-trust-")
    try {
      const configPath = await writeNativeEnvironment(root)
      const initial = await Discovery.discoverProjectEnvironments(project.id, root)
      const candidate = initial.items[0]!

      Store.trustEnvironment(project.id, candidate.configPath, candidate.contentHash)
      expect((await Discovery.discoverProjectEnvironments(project.id, root)).items[0]?.trusted).toBe(true)

      await writeFile(configPath, (await readFile(configPath, "utf8")).replace("npm run dev", "npm run preview"))
      const changed = (await Discovery.discoverProjectEnvironments(project.id, root)).items[0]!

      expect(changed.contentHash).not.toBe(candidate.contentHash)
      expect(changed.trusted).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("preserves JSONC comments and rejects a stale expected hash", async () => {
    const { root, project } = await createGitRepo("anybox-environment-save-")
    try {
      await writeNativeEnvironment(root)
      const before = (await Discovery.discoverProjectEnvironments(project.id, root)).items[0]!
      const definition = {
        ...before.definition!,
        name: "Updated environment",
      }
      const saved = await EnvironmentManager.saveNativeEnvironment({
        projectID: project.id,
        directory: root,
        definition,
        expectedHash: before.contentHash,
        trust: true,
      })

      expect(saved.trusted).toBe(true)
      expect(await readFile(saved.configPath, "utf8")).toContain("// This comment must survive edits.")

      let conflict: unknown
      try {
        await EnvironmentManager.saveNativeEnvironment({
          projectID: project.id,
          directory: root,
          definition: { ...definition, name: "Stale write" },
          expectedHash: before.contentHash,
          trust: false,
        })
      } catch (error) {
        conflict = error
      }
      expect(conflict).toBeInstanceOf(ApiError)
      expect((conflict as ApiError).code).toBe("ENVIRONMENT_CONFLICT")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("imports Codex TOML without modifying the source file or overwriting native JSONC", async () => {
    const { root, project } = await createGitRepo("anybox-environment-import-")
    try {
      const codexPath = await writeCodexEnvironment(root, "Imported")
      const codexText = await readFile(codexPath, "utf8")
      const codex = (await Discovery.discoverProjectEnvironments(project.id, root)).items[0]!
      const imported = await EnvironmentManager.importEnvironment({
        projectID: project.id,
        directory: root,
        key: codex.key,
        expectedHash: codex.contentHash,
        trust: false,
      })

      expect(imported.source).toBe("anybox-jsonc")
      expect(imported.definition?.name).toBe("Imported")
      expect(await readFile(codexPath, "utf8")).toBe(codexText)

      let duplicate: unknown
      try {
        await EnvironmentManager.importEnvironment({
          projectID: project.id,
          directory: root,
          key: codex.key,
          expectedHash: codex.contentHash,
          trust: false,
        })
      } catch (error) {
        duplicate = error
      }
      expect(duplicate).toBeInstanceOf(ApiError)
      expect((duplicate as ApiError).code).toBe("ENVIRONMENT_NATIVE_EXISTS")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe("environment definition validation", () => {
  test("enforces cwd boundaries, unique action IDs, and platform script precedence", () => {
    expect(EnvironmentDefinition.safeParse({
      version: 1,
      name: "Unsafe",
      setup: {
        scripts: { default: "echo setup" },
        cwd: "../outside",
      },
      actions: [],
    }).success).toBe(false)

    expect(EnvironmentDefinition.safeParse({
      version: 1,
      name: "Duplicate",
      actions: [
        { id: "dev", name: "One", scripts: { default: "one" }, cwd: "." },
        { id: "dev", name: "Two", scripts: { default: "two" }, cwd: "." },
      ],
    }).success).toBe(false)

    expect(resolveEnvironmentScript(
      { default: "default", windows: "windows" },
      "windows",
    )).toBe("windows")
    expect(resolveEnvironmentScript(
      { default: "default", windows: "windows" },
      "linux",
    )).toBe("default")
  })
})
