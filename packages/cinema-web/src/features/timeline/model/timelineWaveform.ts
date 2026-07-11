export function timelineSourceRangePeaks(
  peaks: readonly number[],
  sourceInUs: number,
  sourceDurationUs: number,
  assetDurationUs: number | null,
) {
  if (peaks.length <= 1 || assetDurationUs === null || assetDurationUs <= 0) return [...peaks]
  const safeStartUs = Math.min(assetDurationUs, Math.max(0, sourceInUs))
  const safeEndUs = Math.min(assetDurationUs, Math.max(safeStartUs, safeStartUs + sourceDurationUs))
  const lastIndex = peaks.length - 1
  const startIndex = Math.max(0, Math.floor(safeStartUs / assetDurationUs * lastIndex))
  const endIndex = Math.min(lastIndex, Math.ceil(safeEndUs / assetDurationUs * lastIndex))
  if (endIndex <= startIndex) return [peaks[startIndex] ?? 0]
  return peaks.slice(startIndex, endIndex + 1)
}
