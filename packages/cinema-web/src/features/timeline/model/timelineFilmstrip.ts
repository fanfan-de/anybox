export const TIMELINE_FILMSTRIP_CELL_WIDTH_PX = 72

export type TimelineFilmstripCell = {
  index: number
  leftPx: number
  widthPx: number
}

export function timelineFilmstripCells({
  clipLeftPx,
  clipWidthPx,
  visibleStartPx,
  visibleEndPx,
  cellWidthPx = TIMELINE_FILMSTRIP_CELL_WIDTH_PX,
  overscanCells = 1,
}: {
  clipLeftPx: number
  clipWidthPx: number
  visibleStartPx: number
  visibleEndPx: number
  cellWidthPx?: number
  overscanCells?: number
}) {
  if (clipWidthPx <= 0 || cellWidthPx <= 0 || visibleEndPx < clipLeftPx || visibleStartPx > clipLeftPx + clipWidthPx) return []
  const totalCells = Math.max(1, Math.ceil(clipWidthPx / cellWidthPx))
  const localVisibleStart = Math.max(0, visibleStartPx - clipLeftPx)
  const localVisibleEnd = Math.min(clipWidthPx, visibleEndPx - clipLeftPx)
  const startIndex = Math.max(0, Math.floor(localVisibleStart / cellWidthPx) - overscanCells)
  const endIndex = Math.min(
    totalCells - 1,
    Math.floor(Math.max(0, localVisibleEnd - 1) / cellWidthPx) + overscanCells,
  )
  const cells: TimelineFilmstripCell[] = []
  for (let index = startIndex; index <= endIndex; index += 1) {
    const leftPx = index * cellWidthPx
    cells.push({
      index,
      leftPx,
      widthPx: Math.min(cellWidthPx, clipWidthPx - leftPx),
    })
  }
  return cells
}
