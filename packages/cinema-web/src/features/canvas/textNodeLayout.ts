export const TEXT_NODE_MIN_LINES = 4
export const TEXT_NODE_MAX_LINES = 12
const APPROXIMATE_CHARACTERS_PER_LINE = 42

export function textNodeVisibleLineCount(text: string): number {
  const lines = text.length === 0
    ? 1
    : text.split("\n").reduce((count, line) => (
      count + Math.max(1, Math.ceil(line.length / APPROXIMATE_CHARACTERS_PER_LINE))
    ), 0)
  return Math.min(TEXT_NODE_MAX_LINES, Math.max(TEXT_NODE_MIN_LINES, lines))
}
