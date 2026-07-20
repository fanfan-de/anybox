import type {
  BrowserContractErrorCode,
  BrowserContractV3PlaywrightCommandMethod,
} from "@anybox/chrome-shared/browser-contract"

type LocatorCommandMetric = {
  event: "command"
  method: BrowserContractV3PlaywrightCommandMethod
  durationMs: number
  matchCount?: number
  errorCode?: BrowserContractErrorCode | "INTERNAL_ERROR"
}

type LocatorFrameMetric = {
  event: "frame-attach"
  oopif: boolean
}

type LocatorEngineMetric = {
  event: "engine-init"
  engineVersion: string
}

export type LocatorMetric =
  | LocatorCommandMetric
  | LocatorFrameMetric
  | LocatorEngineMetric

export function recordLocatorMetric(metric: LocatorMetric) {
  const record = metric.event === "command"
    ? {
        event: metric.event,
        method: metric.method,
        durationMs: Math.max(0, Math.round(metric.durationMs)),
        ...(metric.matchCount === undefined
          ? {}
          : { matchCount: Math.max(0, Math.trunc(metric.matchCount)) }),
        ...(metric.errorCode ? { errorCode: metric.errorCode } : {}),
      }
    : metric.event === "frame-attach"
      ? { event: metric.event, oopif: metric.oopif }
      : {
          event: metric.event,
          engineVersion: metric.engineVersion,
        }
  try {
    console.debug("[anybox-chrome:locator]", JSON.stringify(record))
  } catch {
    // Diagnostics must not affect browser command execution.
  }
}
