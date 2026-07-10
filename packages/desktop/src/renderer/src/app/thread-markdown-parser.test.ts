import type { Element, Nodes, Root } from "hast"
import { describe, expect, it } from "vitest"
import { normalizeLocalFileLinkTarget } from "./thread-markdown-normalize"
import { parseThreadMarkdownDocument } from "./thread-markdown-parser"
import {
  THREAD_COMPLETED_MARKDOWN_PREVIEW_OMISSION_MARKER,
  THREAD_MARKDOWN_PREVIEW_CHARACTER_LIMIT,
  buildBoundedMarkdownPreview,
} from "./thread-markdown-preview"
import {
  THREAD_MARKDOWN_BLOCK_TARGET_CHARACTER_COUNT,
  THREAD_MARKDOWN_OVERSIZED_BLOCK_CHARACTER_COUNT,
  THREAD_MARKDOWN_OVERSIZED_BLOCK_NODE_COUNT,
  THREAD_MARKDOWN_PIPELINE_VERSION,
} from "./thread-markdown-worker-protocol"

function visitHast(node: Nodes, visit: (node: Nodes) => void) {
  visit(node)
  if (!("children" in node) || !Array.isArray(node.children)) return
  for (const child of node.children) visitHast(child, visit)
}

function findElements(blocks: Root[], tagName: string) {
  const matches: Element[] = []
  for (const block of blocks) {
    visitHast(block, (node) => {
      if (node.type === "element" && node.tagName === tagName) matches.push(node)
    })
  }
  return matches
}

function collectHastText(node: Nodes): string {
  if (node.type === "text") return node.value
  if (!("children" in node) || !Array.isArray(node.children)) return ""
  return node.children.map(collectHastText).join("")
}

function hasTopLevelElement(root: Root, tagName: string) {
  return root.children.some((child) => child.type === "element" && child.tagName === tagName)
}

function hasClassName(element: Element, className: string) {
  const value = element.properties.className
  return Array.isArray(value) && value.includes(className)
}

function hasUnpairedSurrogate(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit = value.charCodeAt(index + 1)
      if (nextCodeUnit < 0xdc00 || nextCodeUnit > 0xdfff) return true
      index += 1
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return true
    }
  }
  return false
}

describe("parseThreadMarkdownDocument", () => {
  it("resolves reference links against definitions from the complete document before grouping", () => {
    const filler = Array.from(
      { length: 12 },
      (_, index) => `Paragraph ${index}. ${"filler ".repeat(150)}`,
    ).join("\n\n")
    const text = [
      "Read the [complete guide][guide] before continuing.",
      filler,
      '[guide]: https://example.com/guide "Complete guide"',
    ].join("\n\n")

    const parsed = parseThreadMarkdownDocument("reference-document", text)
    const links = findElements(parsed.blocks, "a")

    expect(parsed.blocks.length).toBeGreaterThan(1)
    expect(links).toHaveLength(1)
    expect(links[0]?.properties).toMatchObject({
      href: "https://example.com/guide",
      title: "Complete guide",
    })
    expect(collectHastText(links[0]!)).toBe("complete guide")
  })

  it("preserves GFM tables and task-list semantics", () => {
    const text = [
      "- [x] Parsed",
      "- [ ] Verified",
      "",
      "| File | Status |",
      "| --- | --- |",
      "| `ThreadView.tsx` | ready |",
    ].join("\n")

    const parsed = parseThreadMarkdownDocument("gfm-document", text)
    const tables = findElements(parsed.blocks, "table")
    const checkboxes = findElements(parsed.blocks, "input")
    const taskLists = findElements(parsed.blocks, "ul")
    const taskItems = findElements(parsed.blocks, "li")

    expect(tables).toHaveLength(1)
    expect(collectHastText(tables[0]!)).toContain("ThreadView.tsx")
    expect(checkboxes).toHaveLength(2)
    expect(checkboxes[0]?.properties).toMatchObject({ checked: true, disabled: true, type: "checkbox" })
    expect(checkboxes[1]?.properties).toMatchObject({ checked: false, disabled: true, type: "checkbox" })
    expect(hasClassName(taskLists[0]!, "contains-task-list")).toBe(true)
    expect(taskItems.every((item) => hasClassName(item, "task-list-item"))).toBe(true)
  })

  it("drops raw HTML nodes while preserving surrounding Markdown text", () => {
    const text = [
      "Before <span data-unsafe=\"true\">readable text</span> after.",
      "",
      "<script>alert('unsafe')</script>",
      "",
      "Final paragraph.",
    ].join("\n")

    const parsed = parseThreadMarkdownDocument("raw-html-document", text)
    const nodeTypes: string[] = []
    for (const block of parsed.blocks) {
      visitHast(block, (node) => nodeTypes.push(node.type))
    }

    expect(nodeTypes).not.toContain("raw")
    expect(findElements(parsed.blocks, "span")).toHaveLength(0)
    expect(findElements(parsed.blocks, "script")).toHaveLength(0)
    expect(parsed.blocks.map(collectHastText).join(" ")).toContain("Before readable text after.")
    expect(parsed.blocks.map(collectHastText).join(" ")).not.toContain("alert('unsafe')")
  })

  it("normalizes loose Windows file links containing spaces and parentheses", () => {
    const windowsPath = String.raw`C:\新建文件夹 (4)\index.html`
    const parsed = parseThreadMarkdownDocument(
      "windows-link-document",
      `[index.html](${windowsPath})`,
    )
    const links = findElements(parsed.blocks, "a")
    const href = String(links[0]?.properties.href ?? "")

    expect(links).toHaveLength(1)
    expect(href).toBe(encodeURI(windowsPath))
    expect(normalizeLocalFileLinkTarget(href)).toEqual({
      lineRange: null,
      path: windowsPath,
    })
    expect(collectHastText(links[0]!)).toBe("index.html")
  })

  it("groups around the target size without splitting large top-level table, list, or code blocks", () => {
    const table = [
      "| Key | Value |",
      "| --- | --- |",
      ...Array.from({ length: 450 }, (_, index) => `| row-${index} | ${"table-value ".repeat(2)} |`),
    ].join("\n")
    const list = Array.from(
      { length: 700 },
      (_, index) => `- item-${index} ${"list-value ".repeat(2)}`,
    ).join("\n")
    const code = `\`\`\`ts\n${"const value = true\n".repeat(550)}\`\`\``
    const text = [
      `Intro ${"paragraph ".repeat(250)}`,
      table,
      `Middle ${"paragraph ".repeat(250)}`,
      list,
      `Later ${"paragraph ".repeat(250)}`,
      code,
      "Done.",
    ].join("\n\n")

    const parsed = parseThreadMarkdownDocument("grouping-document", text)
    const tableBlockIndexes = parsed.blocks
      .map((block, index) => hasTopLevelElement(block, "table") ? index : -1)
      .filter((index) => index >= 0)
    const listBlockIndexes = parsed.blocks
      .map((block, index) => hasTopLevelElement(block, "ul") ? index : -1)
      .filter((index) => index >= 0)
    const codeBlockIndexes = parsed.blocks
      .map((block, index) => hasTopLevelElement(block, "pre") ? index : -1)
      .filter((index) => index >= 0)

    expect(parsed.blocks.length).toBeGreaterThan(3)
    expect(tableBlockIndexes).toHaveLength(1)
    expect(listBlockIndexes).toHaveLength(1)
    expect(codeBlockIndexes).toHaveLength(1)
    for (const index of [...tableBlockIndexes, ...listBlockIndexes, ...codeBlockIndexes]) {
      const manifest = parsed.manifest.blocks[index]!
      expect(manifest.atomic).toBe(true)
      expect(manifest.characterCount).toBeGreaterThan(THREAD_MARKDOWN_BLOCK_TARGET_CHARACTER_COUNT)
    }
  })

  it("removes source positions from every cached HAST node", () => {
    const parsed = parseThreadMarkdownDocument(
      "positionless-document",
      "# Heading\n\nParagraph with **strong text** and [link](https://example.com).",
    )

    for (const block of parsed.blocks) {
      visitHast(block, (node) => {
        expect(Object.prototype.hasOwnProperty.call(node, "position")).toBe(false)
      })
    }
  })

  it("marks a dense atomic table oversized by node count", () => {
    const denseTable = [
      "| Key | Value |",
      "| --- | --- |",
      ...Array.from({ length: 1_650 }, (_, index) => `| ${index} | value-${index} |`),
    ].join("\n")

    const parsed = parseThreadMarkdownDocument("dense-table-document", denseTable)

    expect(parsed.blocks).toHaveLength(1)
    expect(parsed.manifest.blocks[0]).toMatchObject({ atomic: true, oversized: true })
    expect(parsed.manifest.blocks[0]!.nodeCount).toBeGreaterThan(
      THREAD_MARKDOWN_OVERSIZED_BLOCK_NODE_COUNT,
    )
    expect(parsed.manifest.blocks[0]!.characterCount).toBeLessThan(
      THREAD_MARKDOWN_OVERSIZED_BLOCK_CHARACTER_COUNT,
    )
  })

  it("marks a single text block oversized above the character limit", () => {
    const text = "x".repeat(THREAD_MARKDOWN_OVERSIZED_BLOCK_CHARACTER_COUNT + 1)
    const parsed = parseThreadMarkdownDocument("oversized-text-document", text)

    expect(parsed.blocks).toHaveLength(1)
    expect(parsed.manifest.blocks[0]).toMatchObject({
      atomic: true,
      characterCount: text.length,
      oversized: true,
    })
    expect(parsed.manifest.blocks[0]!.previewText.length).toBeLessThanOrEqual(
      THREAD_MARKDOWN_PREVIEW_CHARACTER_LIMIT,
    )
  })

  it("builds bounded previews without splitting surrogate pairs", () => {
    const text = `${"a".repeat(3_999)}😀${"b".repeat(20_000)}🚀tail`
    const preview = buildBoundedMarkdownPreview(text)

    expect(preview.length).toBeLessThanOrEqual(THREAD_MARKDOWN_PREVIEW_CHARACTER_LIMIT)
    expect(preview).toContain(THREAD_COMPLETED_MARKDOWN_PREVIEW_OMISSION_MARKER)
    expect(preview.endsWith("🚀tail")).toBe(true)
    expect(hasUnpairedSurrogate(preview)).toBe(false)
  })

  it("reports manifest totals and stable block identities", () => {
    const text = Array.from(
      { length: 10 },
      (_, index) => `Section ${index}\n\n${"stable content ".repeat(100)}`,
    ).join("\n\n")
    const first = parseThreadMarkdownDocument("stable-document", text)
    const second = parseThreadMarkdownDocument("stable-document", text)

    expect(first.manifest).toMatchObject({
      characterCount: text.length,
      documentID: "stable-document",
      pipelineVersion: THREAD_MARKDOWN_PIPELINE_VERSION,
    })
    expect(first.manifest.parseMilliseconds).toBeGreaterThanOrEqual(0)
    expect(first.manifest.blocks).toHaveLength(first.blocks.length)
    expect(first.manifest.blocks.map((block) => block.index)).toEqual(
      first.manifest.blocks.map((_, index) => index),
    )
    expect(first.manifest.nodeCount).toBe(
      first.manifest.blocks.reduce((total, block) => total + block.nodeCount, 0),
    )
    expect(first.manifest.blocks.map((block) => block.id)).toEqual(
      second.manifest.blocks.map((block) => block.id),
    )
  })
})
