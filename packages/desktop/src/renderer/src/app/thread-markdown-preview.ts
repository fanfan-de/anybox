export const THREAD_MARKDOWN_PREVIEW_CHARACTER_LIMIT = 12_000
export const THREAD_MARKDOWN_PREVIEW_HEAD_CHARACTER_LIMIT = 4_000
export const THREAD_STREAMING_MARKDOWN_PREVIEW_OMISSION_MARKER =
  "\n\n… Earlier live response content omitted …\n\n"
export const THREAD_COMPLETED_MARKDOWN_PREVIEW_OMISSION_MARKER =
  "\n\n… Earlier response content omitted …\n\n"

export interface BoundedMarkdownPreviewOptions {
  characterLimit?: number
  headCharacterLimit?: number
  omissionMarker?: string
}

function isHighSurrogate(codeUnit: number) {
  return codeUnit >= 0xd800 && codeUnit <= 0xdbff
}

function isLowSurrogate(codeUnit: number) {
  return codeUnit >= 0xdc00 && codeUnit <= 0xdfff
}

function avoidSplittingSurrogatePairAtEnd(text: string, endIndex: number) {
  if (endIndex <= 0 || endIndex >= text.length) return endIndex
  return isHighSurrogate(text.charCodeAt(endIndex - 1)) && isLowSurrogate(text.charCodeAt(endIndex))
    ? endIndex - 1
    : endIndex
}

function avoidSplittingSurrogatePairAtStart(text: string, startIndex: number) {
  if (startIndex <= 0 || startIndex >= text.length) return startIndex
  return isHighSurrogate(text.charCodeAt(startIndex - 1)) && isLowSurrogate(text.charCodeAt(startIndex))
    ? startIndex + 1
    : startIndex
}

export function buildBoundedMarkdownPreview(
  text: string,
  {
    characterLimit = THREAD_MARKDOWN_PREVIEW_CHARACTER_LIMIT,
    headCharacterLimit = THREAD_MARKDOWN_PREVIEW_HEAD_CHARACTER_LIMIT,
    omissionMarker = THREAD_COMPLETED_MARKDOWN_PREVIEW_OMISSION_MARKER,
  }: BoundedMarkdownPreviewOptions = {},
) {
  if (text.length <= characterLimit) return text

  const contentCharacterBudget = Math.max(0, characterLimit - omissionMarker.length)
  const headCharacterBudget = Math.min(headCharacterLimit, Math.floor(contentCharacterBudget / 2))
  const tailCharacterBudget = contentCharacterBudget - headCharacterBudget
  const headEndIndex = avoidSplittingSurrogatePairAtEnd(text, headCharacterBudget)
  const tailStartIndex = avoidSplittingSurrogatePairAtStart(
    text,
    Math.max(headEndIndex, text.length - tailCharacterBudget),
  )

  return `${text.slice(0, headEndIndex)}${omissionMarker}${text.slice(tailStartIndex)}`
}
