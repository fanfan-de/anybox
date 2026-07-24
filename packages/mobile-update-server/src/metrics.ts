import type { MobileUpdateChannel } from "./types.js"

const RESULTS = ["update", "no_update", "rollback", "invalid", "unavailable"] as const
type Result = (typeof RESULTS)[number]

export class UpdateMetrics {
  private readonly counts = new Map<string, number>()
  private durationCount = 0
  private durationSum = 0

  record(channel: MobileUpdateChannel | "invalid", result: Result, durationMs: number) {
    const key = `${channel}:${result}`
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1)
    this.durationCount += 1
    this.durationSum += durationMs
  }

  render() {
    const lines = [
      "# HELP anybox_mobile_update_requests_total Anonymous Expo Updates protocol requests.",
      "# TYPE anybox_mobile_update_requests_total counter",
    ]
    for (const channel of ["preview", "production", "invalid"] as const) {
      for (const result of RESULTS) {
        const count = this.counts.get(`${channel}:${result}`) ?? 0
        lines.push(`anybox_mobile_update_requests_total{channel="${channel}",result="${result}"} ${count}`)
      }
    }
    lines.push(
      "# HELP anybox_mobile_update_request_duration_ms Request duration in milliseconds.",
      "# TYPE anybox_mobile_update_request_duration_ms summary",
      `anybox_mobile_update_request_duration_ms_count ${this.durationCount}`,
      `anybox_mobile_update_request_duration_ms_sum ${this.durationSum.toFixed(3)}`,
      "",
    )
    return lines.join("\n")
  }
}
