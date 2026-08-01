import {
  TextNode,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedTextNode,
} from "lexical"
import type { ComposerTagData } from "../types"

export interface SerializedComposerTagNode extends SerializedTextNode {
  tagData: ComposerTagData
  type: "composer-tag"
  version: 1
}

function readComposerTagTitle(tagData: ComposerTagData) {
  switch (tagData.kind) {
    case "comment":
      return tagData.title
    case "file":
      return tagData.filePath
    case "long-text":
      return `${tagData.characterCount} chars, ${tagData.lineCount} lines. Click to edit full pasted text.`
    case "mcp":
    case "plugin":
    case "skill":
    case "tool-module":
      return tagData.description ?? tagData.label
  }
}

export function formatComposerTagText(tagData: ComposerTagData) {
  return `@${tagData.label}`
}

function applyComposerTagDomAttributes(element: HTMLElement, tagData: ComposerTagData) {
  element.className = `composer-inline-tag is-${tagData.kind}`
  element.dataset.composerTagKind = tagData.kind
  if (tagData.kind === "long-text") {
    element.dataset.composerTagId = tagData.id
    element.setAttribute("role", "button")
    element.tabIndex = 0
    element.setAttribute("aria-label", `Edit ${tagData.label}`)
  } else {
    delete element.dataset.composerTagId
    element.removeAttribute("role")
    element.removeAttribute("aria-label")
    element.tabIndex = -1
  }
  element.contentEditable = "false"
  element.spellcheck = false
  element.title = readComposerTagTitle(tagData)
}

export class ComposerTagNode extends TextNode {
  __tagData: ComposerTagData

  static getType() {
    return "composer-tag"
  }

  static clone(node: ComposerTagNode) {
    return new ComposerTagNode(node.__tagData, node.__key)
  }

  static importJSON(serializedNode: SerializedComposerTagNode) {
    return $createComposerTagNode(serializedNode.tagData)
  }

  constructor(tagData: ComposerTagData, key?: NodeKey) {
    super(formatComposerTagText(tagData), key)
    this.__tagData = tagData
    this.__mode = 1
  }

  createDOM(config: EditorConfig) {
    const element = super.createDOM(config)
    applyComposerTagDomAttributes(element, this.__tagData)
    return element
  }

  updateDOM(prevNode: this, dom: HTMLElement, config: EditorConfig) {
    const updated = super.updateDOM(prevNode, dom, config)
    if (prevNode.__tagData !== this.__tagData || prevNode.__text !== this.__text) {
      applyComposerTagDomAttributes(dom, this.__tagData)
    }
    return updated
  }

  canInsertTextBefore() {
    return false
  }

  canInsertTextAfter() {
    return false
  }

  isTextEntity() {
    return true
  }

  getTagData() {
    return this.getLatest().__tagData
  }

  exportJSON(): SerializedComposerTagNode {
    return {
      ...super.exportJSON(),
      tagData: this.getTagData(),
      type: "composer-tag",
      version: 1,
    }
  }
}

export function $createComposerTagNode(tagData: ComposerTagData) {
  return new ComposerTagNode(tagData)
}

export function $isComposerTagNode(node: LexicalNode | null | undefined): node is ComposerTagNode {
  return node instanceof ComposerTagNode
}
