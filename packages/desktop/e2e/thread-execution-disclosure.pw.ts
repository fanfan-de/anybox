import { expect, test } from "@playwright/test"

const TARGET_MESSAGE_ID = "assistant-e2e"
const SECOND_TARGET_MESSAGE_ID = "assistant-e2e-second"
const TARGET_GROUP_ID = "turn:turn-e2e"
const PENDING_GROUP_ID = "turn:pending:user-e2e"

test("real ThreadView preserves its semantic anchor when a completed turn collapses", async ({ page }) => {
  const pageErrors: string[] = []
  page.on("pageerror", (error) => pageErrors.push(error.message))

  await page.goto("/e2e/thread-execution-harness.html")
  await page.locator("#canonicalize-turn").click()

  const thread = page.locator(".thread-column.is-virtualized")
  const spacer = thread.locator(":scope > .thread-virtual-spacer")
  const summary = thread.locator(
    `.assistant-execution-summary-button[data-thread-execution-group-id="${TARGET_GROUP_ID}"]`,
  )
  const targetTool = thread.locator(
    `[data-thread-message-id="${TARGET_MESSAGE_ID}"][data-assistant-item-id="process-tool-6"]`,
  )

  await expect(thread).toBeVisible()
  await expect(spacer).toBeVisible()
  await expect(summary).toHaveAttribute("aria-expanded", "true")
  await expect(targetTool).toBeVisible()

  const virtualization = await thread.evaluate((element) => {
    const spacerElement = element.querySelector<HTMLElement>(":scope > .thread-virtual-spacer")!
    return {
      renderedRows: spacerElement.querySelectorAll(":scope > .thread-virtual-row").length,
      totalHeight: spacerElement.getBoundingClientRect().height,
      viewportHeight: element.clientHeight,
    }
  })
  expect(virtualization.renderedRows).toBeLessThan(80)
  expect(virtualization.totalHeight).toBeGreaterThan(virtualization.viewportHeight * 3)

  await targetTool.evaluate((element) => {
    const column = element.closest<HTMLDivElement>(".thread-column")!
    element.scrollIntoView({ block: "start" })
    column.scrollTop = Math.max(0, column.scrollTop - 32)
    column.dispatchEvent(new Event("scroll", { bubbles: true }))
  })
  await page.waitForTimeout(100)

  const before = await thread.evaluate((column, messageID) => {
    const columnRect = column.getBoundingClientRect()
    const processKinds = new Set(["assistant-reasoning-row", "assistant-tool-row"])
    const processRows = Array.from(
      column.querySelectorAll<HTMLElement>(`[data-thread-message-id="${messageID}"]`),
    )
      .filter((element) => processKinds.has(element.dataset.threadRowKind ?? ""))
      .map((element) => element.closest<HTMLElement>("[data-thread-virtual-row-id]"))
      .filter((element): element is HTMLElement => Boolean(element))
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .sort((left, right) => left.rect.top - right.rect.top)
    const source = processRows.find(({ rect }) => rect.bottom > columnRect.top)
    if (!source) throw new Error("No mounted process anchor row was found")

    return {
      sourceRowID: source.element.dataset.threadVirtualRowId,
      viewportOffset: source.rect.top - columnRect.top,
    }
  }, TARGET_MESSAGE_ID)
  expect(before.sourceRowID).toBeTruthy()

  await page.locator("#complete-turn").click()
  await expect(summary).toHaveAttribute("aria-expanded", "false")
  await expect(targetTool).toHaveCount(0)

  const finalResponse = thread.getByText("E2E final response remains visible.", { exact: true })
  await expect(finalResponse).toBeVisible()
  await expect.poll(async () => {
    return thread.evaluate((column, expectedOffset) => {
      const summaryRow = column.querySelector<HTMLElement>(
        '[data-thread-virtual-row-id="turn:turn-e2e:execution-summary"]',
      )
      if (!summaryRow) return Number.POSITIVE_INFINITY
      return Math.abs(
        summaryRow.getBoundingClientRect().top - column.getBoundingClientRect().top - expectedOffset,
      )
    }, before.viewportOffset)
  }).toBeLessThanOrEqual(1)

  const browserBehavior = await thread.evaluate(async (column) => {
    const overflowAnchor = getComputedStyle(column).overflowAnchor
    column.scrollTop = Number.MAX_SAFE_INTEGER
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    return {
      clampedScrollTop: column.scrollTop,
      maxScrollTop: column.scrollHeight - column.clientHeight,
      overflowAnchor,
    }
  })

  expect(browserBehavior.overflowAnchor).toBe("none")
  expect(Math.abs(browserBehavior.clampedScrollTop - browserBehavior.maxScrollTop)).toBeLessThanOrEqual(1)
  expect(pageErrors).toEqual([])
})

test("upward wheel scrolling leaves bottom follow without virtualizer scroll bounce", async ({ page }) => {
  const pageErrors: string[] = []
  page.on("pageerror", (error) => pageErrors.push(error.message))

  await page.goto("/e2e/thread-execution-harness.html")
  const thread = page.locator(".thread-column.is-virtualized")
  await expect(thread).toBeVisible()

  await thread.evaluate((column) => {
    column.scrollTop = column.scrollHeight
  })
  await page.waitForTimeout(250)

  const before = await thread.evaluate((column) => ({
    distanceFromBottom: column.scrollHeight - column.scrollTop - column.clientHeight,
    scrollTop: column.scrollTop,
  }))
  expect(before.distanceFromBottom).toBeLessThanOrEqual(32)

  await thread.evaluate((column) => {
    const typedWindow = window as typeof window & {
      __threadWheelScrollEvents?: Array<{ isTrusted: boolean; scrollTop: number }>
    }
    typedWindow.__threadWheelScrollEvents = []
    column.addEventListener("scroll", (event) => {
      typedWindow.__threadWheelScrollEvents!.push({
        isTrusted: event.isTrusted,
        scrollTop: column.scrollTop,
      })
    })
  })

  const bounds = await thread.boundingBox()
  if (!bounds) throw new Error("Thread viewport has no browser bounds")
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await page.mouse.wheel(0, -120)

  await expect.poll(async () => page.evaluate(() => {
    const typedWindow = window as typeof window & {
      __threadWheelScrollEvents?: Array<{ isTrusted: boolean; scrollTop: number }>
    }
    return typedWindow.__threadWheelScrollEvents?.length ?? 0
  })).toBeGreaterThan(0)
  await page.waitForTimeout(100)

  const result = await thread.evaluate((column) => {
    const typedWindow = window as typeof window & {
      __threadWheelScrollEvents?: Array<{ isTrusted: boolean; scrollTop: number }>
    }
    const events = typedWindow.__threadWheelScrollEvents ?? []
    const hasDownwardReversal = events.some((event, index) => (
      index > 0 && event.scrollTop > events[index - 1]!.scrollTop + 1
    ))
    return {
      events,
      finalScrollTop: column.scrollTop,
      hasDownwardReversal,
    }
  })

  expect(result.events.every((event) => event.isTrusted)).toBe(true)
  expect(result.hasDownwardReversal, JSON.stringify(result.events)).toBe(false)
  expect(result.finalScrollTop).toBeLessThan(before.scrollTop - 80)
  expect(pageErrors).toEqual([])
})

test("pending turn canonicalization never exposes duplicate processing summaries", async ({ page }) => {
  const pageErrors: string[] = []
  page.on("pageerror", (error) => pageErrors.push(error.message))

  await page.goto("/e2e/thread-execution-harness.html")

  const thread = page.locator(".thread-column.is-virtualized")
  const pendingSummary = thread.locator(
    `.assistant-execution-summary-button[data-thread-execution-group-id="${PENDING_GROUP_ID}"]`,
  )
  const canonicalSummary = thread.locator(
    `.assistant-execution-summary-button[data-thread-execution-group-id="${TARGET_GROUP_ID}"]`,
  )
  await expect(pendingSummary).toHaveCount(1)
  await expect(pendingSummary).toHaveAttribute("aria-expanded", "true")

  await pendingSummary.click()
  await expect(pendingSummary).toHaveAttribute("aria-expanded", "false")

  await thread.evaluate((column, groupIDs) => {
    const readSummaries = () => Array.from(
      column.querySelectorAll<HTMLElement>(".assistant-execution-summary-button"),
    ).filter((element) => groupIDs.includes(element.dataset.threadExecutionGroupId ?? ""))
    const state = {
      expandedObservationCount: 0,
      expandedGroupIDs: [] as string[],
      maxCount: 0,
    }
    const sample = () => {
      const summaries = readSummaries()
      state.maxCount = Math.max(state.maxCount, summaries.length)
      const expandedGroupIDs = summaries.flatMap((element) => (
        element.getAttribute("aria-expanded") === "true"
          ? [element.dataset.threadExecutionGroupId ?? "unknown"]
          : []
      ))
      if (expandedGroupIDs.length > 0) {
        state.expandedObservationCount += 1
        state.expandedGroupIDs.push(...expandedGroupIDs)
      }
    }
    sample()
    ;(window as typeof window & { __threadSummaryObservation?: typeof state }).__threadSummaryObservation = state
    const observer = new MutationObserver(() => {
      sample()
    })
    observer.observe(column, {
      attributeFilter: ["aria-expanded"],
      attributes: true,
      childList: true,
      subtree: true,
    })
    const sampleFrame = () => {
      sample()
      const frameID = requestAnimationFrame(sampleFrame)
      ;(window as typeof window & { __threadSummaryFrameID?: number }).__threadSummaryFrameID = frameID
    }
    const frameID = requestAnimationFrame(sampleFrame)
    const typedWindow = window as typeof window & {
      __threadSummaryFrameID?: number
      __threadSummaryObserver?: MutationObserver
    }
    typedWindow.__threadSummaryFrameID = frameID
    typedWindow.__threadSummaryObserver = observer
  }, [PENDING_GROUP_ID, TARGET_GROUP_ID])

  await page.locator("#canonicalize-turn").click()

  await expect(pendingSummary).toHaveCount(0)
  await expect(canonicalSummary).toHaveCount(1)
  await expect(canonicalSummary).toHaveAttribute("aria-expanded", "false")
  await expect(page.locator(".thread-e2e-harness")).toHaveAttribute("data-target-turn-count", "1")
  await expect(page.locator(".thread-e2e-harness")).toHaveAttribute("data-target-assistant-count", "2")
  await expect(
    thread.locator(`[data-thread-message-id="${SECOND_TARGET_MESSAGE_ID}"]`).filter({
      hasText: "E2E final response remains visible.",
    }),
  ).toHaveCount(1)
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  }))
  const observation = await page.evaluate(() => {
    const typedWindow = window as typeof window & {
      __threadSummaryFrameID?: number
      __threadSummaryObservation?: {
        expandedGroupIDs: string[]
        expandedObservationCount: number
        maxCount: number
      }
      __threadSummaryObserver?: MutationObserver
    }
    typedWindow.__threadSummaryObserver?.disconnect()
    if (typedWindow.__threadSummaryFrameID !== undefined) {
      cancelAnimationFrame(typedWindow.__threadSummaryFrameID)
    }
    return typedWindow.__threadSummaryObservation ?? {
      expandedGroupIDs: ["missing-observer"],
      expandedObservationCount: Number.POSITIVE_INFINITY,
      maxCount: Number.POSITIVE_INFINITY,
    }
  })

  expect(observation.maxCount).toBeLessThanOrEqual(1)
  expect(observation.expandedObservationCount, observation.expandedGroupIDs.join(", ")).toBe(0)
  expect(pageErrors).toEqual([])
})
