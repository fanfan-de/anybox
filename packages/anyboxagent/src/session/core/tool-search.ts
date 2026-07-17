import type * as Tool from "#tool/tool.ts"

const BM25_K1 = 1.2
const BM25_B = 0.75
const DEFAULT_LIMIT = 8
const MAX_LIMIT = 32

export interface ToolSearchDefinition {
  id: string
  name: string
  title?: string
  description: string
  inputSchema: Record<string, unknown>
  source: Tool.ToolSource
}

type IndexedDocument = {
  definition: ToolSearchDefinition
  frequencies: Map<string, number>
  length: number
  normalizedFields: string[]
}

function normalizedText(value: string) {
  return value.normalize("NFKC").trim().toLowerCase()
}

function cjkNgrams(value: string) {
  const result: string[] = []
  for (const match of value.matchAll(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu)) {
    const characters = [...match[0]]
    result.push(...characters)
    for (let index = 0; index < characters.length - 1; index += 1) {
      result.push(`${characters[index]}${characters[index + 1]}`)
    }
  }
  return result
}

export function tokenizeToolSearchText(value: string) {
  const normalized = normalizedText(value)
  if (!normalized) return []

  const tokens = normalized.match(/[a-z0-9]+/g) ?? []
  const segmented = typeof Intl.Segmenter === "function"
    ? [...new Intl.Segmenter(undefined, { granularity: "word" }).segment(normalized)]
      .filter((part) => part.isWordLike)
      .map((part) => normalizedText(part.segment))
    : []

  return [...tokens, ...segmented, ...cjkNgrams(normalized)].filter(Boolean)
}

function searchableText(definition: ToolSearchDefinition) {
  return [
    definition.id,
    definition.name,
    definition.title,
    definition.description,
    definition.source.id,
    definition.source.name,
    definition.source.description,
    JSON.stringify(definition.inputSchema),
  ].filter((value): value is string => typeof value === "string" && value.length > 0)
}

function indexDocument(definition: ToolSearchDefinition): IndexedDocument {
  const fields = searchableText(definition)
  const tokens = tokenizeToolSearchText(fields.join("\n"))
  const frequencies = new Map<string, number>()
  for (const token of tokens) {
    frequencies.set(token, (frequencies.get(token) ?? 0) + 1)
  }

  return {
    definition,
    frequencies,
    length: Math.max(tokens.length, 1),
    normalizedFields: fields.map(normalizedText),
  }
}

function normalizeLimit(limit: number | undefined) {
  if (!Number.isFinite(limit)) return DEFAULT_LIMIT
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(limit!)))
}

export class ToolSearchIndex {
  private readonly documents: IndexedDocument[]
  private readonly documentFrequency = new Map<string, number>()
  private readonly averageDocumentLength: number

  constructor(definitions: ToolSearchDefinition[]) {
    this.documents = definitions.map(indexDocument)
    this.averageDocumentLength =
      this.documents.reduce((total, document) => total + document.length, 0) /
      Math.max(this.documents.length, 1)

    for (const document of this.documents) {
      for (const token of document.frequencies.keys()) {
        this.documentFrequency.set(token, (this.documentFrequency.get(token) ?? 0) + 1)
      }
    }
  }

  search(query: string, limit?: number) {
    const normalizedQuery = normalizedText(query)
    const queryTokens = [...new Set(tokenizeToolSearchText(query))]
    if (!normalizedQuery || queryTokens.length === 0) return []

    return this.documents
      .map((document) => ({
        definition: document.definition,
        score: this.score(document, normalizedQuery, queryTokens),
      }))
      .filter((result) => result.score > 0)
      .sort((left, right) =>
        right.score - left.score ||
        (left.definition.name < right.definition.name ? -1 : left.definition.name > right.definition.name ? 1 : 0),
      )
      .slice(0, normalizeLimit(limit))
      .map((result) => result.definition)
  }

  private score(document: IndexedDocument, normalizedQuery: string, queryTokens: string[]) {
    let score = 0
    for (const token of queryTokens) {
      const frequency = document.frequencies.get(token) ?? 0
      if (frequency === 0) continue

      const documentFrequency = this.documentFrequency.get(token) ?? 0
      const inverseDocumentFrequency = Math.log(
        1 + (this.documents.length - documentFrequency + 0.5) / (documentFrequency + 0.5),
      )
      const lengthNormalization =
        BM25_K1 *
        (1 - BM25_B + BM25_B * (document.length / Math.max(this.averageDocumentLength, 1)))
      score += inverseDocumentFrequency *
        ((frequency * (BM25_K1 + 1)) / (frequency + lengthNormalization))
    }

    const [id, name] = document.normalizedFields
    if (id === normalizedQuery || name === normalizedQuery) {
      score += 20
    } else if (id?.includes(normalizedQuery) || name?.includes(normalizedQuery)) {
      score += 5
    } else if (document.normalizedFields.some((field) => field.includes(normalizedQuery))) {
      score += 2
    }

    return score
  }
}

export function createToolSearchIndex(definitions: ToolSearchDefinition[]) {
  return new ToolSearchIndex(definitions)
}
