import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const skillURL = new URL("../skills/computer-use/SKILL.md", import.meta.url)
const apiDocsURL = new URL("../docs/api.md", import.meta.url)

test("documents the Node REPL explicit-return contract for Computer Use", async () => {
  const [skill, apiDocs] = await Promise.all([
    readFile(skillURL, "utf8"),
    readFile(apiDocsURL, "utf8"),
  ])

  assert.match(skill, /async function body/u)
  assert.match(skill, /return globalThis\.computerUseApps/u)
  assert.match(skill, /return await sky\.documentation\("api"\)/u)
  assert.match(apiDocs, /bare expression[\s\S]+`null` tool result/u)
  assert.match(apiDocs, /return globalThis\.computerUseState/u)
})
