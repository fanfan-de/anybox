export function clampContextMenuPosition(
  x: number,
  y: number,
  menuWidth: number,
  menuHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  margin = 8,
): { x: number; y: number } {
  const maxX = Math.max(margin, viewportWidth - menuWidth - margin)
  const maxY = Math.max(margin, viewportHeight - menuHeight - margin)

  return {
    x: Math.min(Math.max(x, margin), maxX),
    y: Math.min(Math.max(y, margin), maxY),
  }
}
