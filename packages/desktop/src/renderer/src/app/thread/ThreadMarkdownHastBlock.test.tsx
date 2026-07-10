import { render, screen } from "@testing-library/react"
import type { Element, Root } from "hast"
import type { Components } from "react-markdown"
import { describe, expect, it } from "vitest"
import { ThreadMarkdownHastBlock } from "./ThreadMarkdownHastBlock"

function createBasicRoot(): Root {
  return {
    type: "root",
    children: [
      {
        type: "element",
        tagName: "h2",
        properties: { id: "release-notes" },
        children: [{ type: "text", value: "Release notes" }],
      },
      {
        type: "element",
        tagName: "p",
        properties: {},
        children: [
          { type: "text", value: "Read the " },
          {
            type: "element",
            tagName: "a",
            properties: { href: "https://example.com/docs" },
            children: [{ type: "text", value: "documentation" }],
          },
          { type: "text", value: "." },
        ],
      },
      {
        type: "element",
        tagName: "pre",
        properties: {},
        children: [
          {
            type: "element",
            tagName: "code",
            properties: { className: ["language-ts"] },
            children: [{ type: "text", value: "const ready = true\n" }],
          },
        ],
      },
      {
        type: "element",
        tagName: "table",
        properties: {},
        children: [
          {
            type: "element",
            tagName: "thead",
            properties: {},
            children: [
              {
                type: "element",
                tagName: "tr",
                properties: {},
                children: [
                  {
                    type: "element",
                    tagName: "th",
                    properties: {},
                    children: [{ type: "text", value: "File" }],
                  },
                  {
                    type: "element",
                    tagName: "th",
                    properties: {},
                    children: [{ type: "text", value: "Status" }],
                  },
                ],
              },
            ],
          },
          {
            type: "element",
            tagName: "tbody",
            properties: {},
            children: [
              {
                type: "element",
                tagName: "tr",
                properties: {},
                children: [
                  {
                    type: "element",
                    tagName: "td",
                    properties: {},
                    children: [{ type: "text", value: "ThreadView.tsx" }],
                  },
                  {
                    type: "element",
                    tagName: "td",
                    properties: {},
                    children: [{ type: "text", value: "ready" }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  }
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value

  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child)
  }
  return Object.freeze(value)
}

describe("ThreadMarkdownHastBlock", () => {
  it("renders HAST blocks as direct siblings without adding a wrapper", () => {
    const root = createBasicRoot()
    const { container } = render(
      <ThreadMarkdownHastBlock components={{}} root={root} />,
    )

    expect(Array.from(container.children, (element) => element.tagName)).toEqual([
      "H2",
      "P",
      "PRE",
      "TABLE",
    ])
    expect(screen.getByRole("heading", { name: "Release notes" })).toHaveAttribute(
      "id",
      "release-notes",
    )
    expect(screen.getByRole("link", { name: "documentation" })).toHaveAttribute(
      "href",
      "https://example.com/docs",
    )
    expect(container.querySelector("code.language-ts")).toHaveTextContent("const ready = true")
    expect(screen.getByRole("table")).toHaveTextContent("ThreadView.tsxready")
  })

  it("uses react-markdown components and passes the original HAST node", () => {
    const root = createBasicRoot()
    const linkNode = (root.children[1] as Element).children[1] as Element
    let receivedNode: Element | undefined
    const components: Components = {
      a({ children, node, href }) {
        receivedNode = node
        return (
          <button data-href={href} type="button">
            {children}
          </button>
        )
      },
    }

    render(<ThreadMarkdownHastBlock components={components} root={root} />)

    expect(screen.queryByRole("link", { name: "documentation" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "documentation" })).toHaveAttribute(
      "data-href",
      "https://example.com/docs",
    )
    expect(receivedNode).toBe(linkNode)
  })

  it("keeps a cached root and its nodes immutable across rerenders", () => {
    const root = deepFreeze(createBasicRoot())
    const originalRoot = root
    const headingNode = root.children[0] as Element
    const receivedNodes: Array<Element | undefined> = []
    const createComponents = (revision: string): Components => ({
      h2({ children, node }) {
        receivedNodes.push(node)
        return <h2 data-revision={revision}>{children}</h2>
      },
    })
    const { rerender } = render(
      <ThreadMarkdownHastBlock components={createComponents("first")} root={root} />,
    )

    rerender(
      <ThreadMarkdownHastBlock components={createComponents("second")} root={root} />,
    )

    expect(root).toBe(originalRoot)
    expect(root.children[0]).toBe(headingNode)
    expect(Object.isFrozen(root)).toBe(true)
    expect(Object.isFrozen(headingNode)).toBe(true)
    expect(receivedNodes.length).toBeGreaterThanOrEqual(2)
    expect(receivedNodes.every((node) => node === headingNode)).toBe(true)
    expect(screen.getByRole("heading", { name: "Release notes" })).toHaveAttribute(
      "data-revision",
      "second",
    )
  })
})
