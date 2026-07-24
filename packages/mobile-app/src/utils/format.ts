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

type RelativeTimeUnit = "second" | "minute" | "hour" | "day"

const fallbackRelativeTimeByLocale: Record<
  MobileLocale,
  Record<RelativeTimeUnit, (amount: number) => string>
> = {
  "zh-CN": {
    second: () => "刚刚",
    minute: (amount) => `${amount} 分钟前`,
    hour: (amount) => `${amount} 小时前`,
    day: (amount) => `${amount} 天前`,
  },
  "zh-TW": {
    second: () => "剛剛",
    minute: (amount) => `${amount} 分鐘前`,
    hour: (amount) => `${amount} 小時前`,
    day: (amount) => `${amount} 天前`,
  },
  "en-US": {
    second: () => "Just now",
    minute: (amount) => `${amount}m ago`,
    hour: (amount) => `${amount}h ago`,
    day: (amount) => `${amount}d ago`,
  },
  "ja-JP": {
    second: () => "たった今",
    minute: (amount) => `${amount}分前`,
    hour: (amount) => `${amount}時間前`,
    day: (amount) => `${amount}日前`,
  },
  "ko-KR": {
    second: () => "방금",
    minute: (amount) => `${amount}분 전`,
    hour: (amount) => `${amount}시간 전`,
    day: (amount) => `${amount}일 전`,
  },
  "pt-BR": {
    second: () => "agora",
    minute: (amount) => `há ${amount} min`,
    hour: (amount) => `há ${amount} h`,
    day: (amount) => `há ${amount} d`,
  },
  "es-419": {
    second: () => "ahora",
    minute: (amount) => `hace ${amount} min`,
    hour: (amount) => `hace ${amount} h`,
    day: (amount) => `hace ${amount} d`,
  },
  "de-DE": {
    second: () => "jetzt",
    minute: (amount) => `vor ${amount} Min.`,
    hour: (amount) => `vor ${amount} Std.`,
    day: (amount) => `vor ${amount} T.`,
  },
  "fr-FR": {
    second: () => "maintenant",
    minute: (amount) => `il y a ${amount} min`,
    hour: (amount) => `il y a ${amount} h`,
    day: (amount) => `il y a ${amount} j`,
  },
  "id-ID": {
    second: () => "sekarang",
    minute: (amount) => `${amount} mnt lalu`,
    hour: (amount) => `${amount} jam lalu`,
    day: (amount) => `${amount} hr lalu`,
  },
  "it-IT": {
    second: () => "ora",
    minute: (amount) => `${amount} min fa`,
    hour: (amount) => `${amount} h fa`,
    day: (amount) => `${amount} g fa`,
  },
  "pl-PL": {
    second: () => "teraz",
    minute: (amount) => `${amount} min temu`,
    hour: (amount) => `${amount} godz. temu`,
    day: (amount) => `${amount} dni temu`,
  },
  "tr-TR": {
    second: () => "şimdi",
    minute: (amount) => `${amount} dk önce`,
    hour: (amount) => `${amount} sa önce`,
    day: (amount) => `${amount} gün önce`,
  },
  "vi-VN": {
    second: () => "vừa xong",
    minute: (amount) => `${amount} phút trước`,
    hour: (amount) => `${amount} giờ trước`,
    day: (amount) => `${amount} ngày trước`,
  },
}

export function formatRelativeTime(value: number | undefined, locale: MobileLocale = "en-US") {
  if (!value) return unknownTimeByLocale[locale]
  const elapsed = Date.now() - value

  let amount = 0
  let unit: RelativeTimeUnit = "second"
  if (elapsed >= 86_400_000) {
    amount = Math.max(1, Math.floor(elapsed / 86_400_000))
    unit = "day"
  } else if (elapsed >= 3_600_000) {
    amount = Math.max(1, Math.floor(elapsed / 3_600_000))
    unit = "hour"
  } else if (elapsed >= 60_000) {
    amount = Math.max(1, Math.floor(elapsed / 60_000))
    unit = "minute"
  }

  const RelativeTimeFormat = typeof Intl === "object" ? Intl.RelativeTimeFormat : undefined
  if (typeof RelativeTimeFormat === "function") {
    try {
      return new RelativeTimeFormat(locale, { numeric: "auto", style: "narrow" }).format(-amount, unit)
    } catch {
      // Some Hermes builds expose only part of Intl. Fall through to the bundled formatter.
    }
  }

  return fallbackRelativeTimeByLocale[locale][unit](amount)
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
