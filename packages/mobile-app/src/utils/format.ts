import type { MobileLocale } from "@/i18n"

export function formatRelativeTime(value: number | undefined, locale: MobileLocale = "en-US") {
  if (!value) return locale === "zh-CN" ? "未知" : "Unknown"
  const elapsed = Date.now() - value
  if (elapsed < 60_000) return locale === "zh-CN" ? "刚刚" : "Just now"
  if (elapsed < 3_600_000) {
    const minutes = Math.max(1, Math.floor(elapsed / 60_000))
    return locale === "zh-CN" ? `${minutes} 分钟前` : `${minutes}m ago`
  }
  if (elapsed < 86_400_000) {
    const hours = Math.max(1, Math.floor(elapsed / 3_600_000))
    return locale === "zh-CN" ? `${hours} 小时前` : `${hours}h ago`
  }
  const days = Math.max(1, Math.floor(elapsed / 86_400_000))
  return locale === "zh-CN" ? `${days} 天前` : `${days}d ago`
}

export function trimMiddle(value: string, maxLength = 52) {
  if (value.length <= maxLength) return value
  const head = Math.ceil((maxLength - 1) / 2)
  const tail = Math.floor((maxLength - 1) / 2)
  return `${value.slice(0, head)}...${value.slice(value.length - tail)}`
}

export function encodeRouteParam(value: string) {
  return encodeURIComponent(value)
}

export function decodeRouteParam(value: string) {
  let current = value
  for (let index = 0; index < 2; index += 1) {
    const next = decodeURIComponent(current)
    if (next === current) break
    current = next
  }
  return current
}
