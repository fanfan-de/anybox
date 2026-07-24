import assert from "node:assert/strict"
import test from "node:test"
import { formatRelativeTime } from "../src/utils/format.ts"

test("formats relative time when Intl.RelativeTimeFormat is unavailable", (context) => {
  const relativeTimeFormatDescriptor = Object.getOwnPropertyDescriptor(Intl, "RelativeTimeFormat")
  const originalDateNow = Date.now
  const now = Date.UTC(2026, 6, 25, 4, 0, 0)

  Object.defineProperty(Intl, "RelativeTimeFormat", {
    configurable: true,
    value: undefined,
  })
  Date.now = () => now

  context.after(() => {
    Date.now = originalDateNow
    if (relativeTimeFormatDescriptor) {
      Object.defineProperty(Intl, "RelativeTimeFormat", relativeTimeFormatDescriptor)
    } else {
      delete Intl.RelativeTimeFormat
    }
  })

  assert.equal(formatRelativeTime(now - 15_000, "zh-CN"), "刚刚")
  assert.equal(formatRelativeTime(now - 5 * 60_000, "zh-CN"), "5 分钟前")
  assert.equal(formatRelativeTime(now - 3 * 3_600_000, "zh-TW"), "3 小時前")
  assert.equal(formatRelativeTime(now - 2 * 86_400_000, "en-US"), "2d ago")
})
