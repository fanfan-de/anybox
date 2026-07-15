import type { AssistantTraceItem, AssistantTraceSectionKey } from "../types"

export interface AssistantResponseBlockBoundary {
  endRawItemIndex: number
  startRawItemIndex: number
}

function traceSectionForFinalResponseBoundary(item: AssistantTraceItem): AssistantTraceSectionKey {
  if (item.section) return item.section
  if (item.kind === "text" || item.kind === "question") return "response"
  if (item.kind === "source") return "sources"
  if (item.kind === "patch" || item.kind === "file" || item.kind === "image") return "file-change"
  if (item.kind === "tool") return "tools"
  if (item.kind === "reasoning") return "reasoning"
  if (item.kind === "system") return "debug"
  return "workflow"
}

export function findLastNonemptyAssistantResponseBlock(
  items: readonly AssistantTraceItem[],
): AssistantResponseBlockBoundary | null {
  let currentStart = -1
  let currentHasText = false
  let latest: AssistantResponseBlockBoundary | null = null

  const finishCurrentBlock = (endRawItemIndex: number) => {
    if (currentStart >= 0 && currentHasText) {
      latest = { endRawItemIndex, startRawItemIndex: currentStart }
    }
    currentStart = -1
    currentHasText = false
  }

  items.forEach((item, rawItemIndex) => {
    if (traceSectionForFinalResponseBoundary(item) !== "response") {
      finishCurrentBlock(rawItemIndex)
      return
    }
    if (currentStart < 0) currentStart = rawItemIndex
    if (item.kind === "text" && Boolean(item.text?.trim())) currentHasText = true
  })
  finishCurrentBlock(items.length)
  return latest
}
