import { expect, test } from "@playwright/test"

const TARGET_MESSAGE_ID = "assistant-e2e"
const TARGET_GROUP_ID = "turn:turn-e2e"

test("real ThreadView preserves its semantic anchor when a completed turn collapses", async ({ page }) => {
  const pageErrors: string[] = []
  page.on("pageerror", (error) => pageErrors.push(error.message))

  await page.goto("/e2e/thread-execution-harness.html")

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
