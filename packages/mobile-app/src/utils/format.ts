import type { MobileLocale } from "@/i18n"

const unknownTimeByLocale: Record<MobileLocale, string> = {
  "zh-CN": "未知",
  "zh-TW": "未知",
  "en-US": "Unknown",
  "ja-JP": "不明",
  "ko-KR": "알 수 없음",
  "pt-BR": "Desconhecido",
  "es-419": "Desconocido",
  "de-DE": "Unbekannt",
  "fr-FR": "Inconnu",
  "id-ID": "Tidak diketahui",
  "it-IT": "Sconosciuto",
  "pl-PL": "Nieznany",
  "tr-TR": "Bilinmiyor",
  "vi-VN": "Không xác định",
}

export function formatRelativeTime(value: number | undefined, locale: MobileLocale = "en-US") {
  if (!value) return unknownTimeByLocale[locale]
  const elapsed = Date.now() - value
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "narrow" })
  if (elapsed < 60_000) return formatter.format(0, "second")
  if (elapsed < 3_600_000) {
    const minutes = Math.max(1, Math.floor(elapsed / 60_000))
    return formatter.format(-minutes, "minute")
  }
  if (elapsed < 86_400_000) {
    const hours = Math.max(1, Math.floor(elapsed / 3_600_000))
    return formatter.format(-hours, "hour")
  }
  const days = Math.max(1, Math.floor(elapsed / 86_400_000))
  return formatter.format(-days, "day")
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
