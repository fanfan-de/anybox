export function timelineAutoScrollVelocity(
  pointerClientX: number,
  viewportLeft: number,
  viewportRight: number,
  edgeThresholdPixels = 48,
  maximumPixelsPerFrame = 22,
) {
  const width = Math.max(0, viewportRight - viewportLeft)
  const threshold = Math.min(Math.max(1, edgeThresholdPixels), width / 2)
  if (pointerClientX < viewportLeft + threshold) {
    const proximity = Math.min(1, Math.max(0, (viewportLeft + threshold - pointerClientX) / threshold))
    return -Math.ceil(maximumPixelsPerFrame * proximity * proximity)
  }
  if (pointerClientX > viewportRight - threshold) {
    const proximity = Math.min(1, Math.max(0, (pointerClientX - viewportRight + threshold) / threshold))
    return Math.ceil(maximumPixelsPerFrame * proximity * proximity)
  }
  return 0
}

export function timelineAutoScrollLeft(
  currentScrollLeft: number,
  velocity: number,
  scrollWidth: number,
  clientWidth: number,
) {
  const maximumScrollLeft = Math.max(0, scrollWidth - clientWidth)
  return Math.min(maximumScrollLeft, Math.max(0, currentScrollLeft + velocity))
}

