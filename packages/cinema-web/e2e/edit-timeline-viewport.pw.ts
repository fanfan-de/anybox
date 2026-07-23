import { expect, test } from "@playwright/test"

const externalCinemaURL = process.env.CINEMA_E2E_URL
const managedAgentPort = process.env.CINEMA_E2E_AGENT_PORT || "4187"
const agentBaseURL = `http://127.0.0.1:${managedAgentPort}`

test.describe("Cinema Timeline viewport", () => {
  test.skip(Boolean(externalCinemaURL), "Viewport assertions use the isolated managed Agent fixture.")

  test("zooms around the pointer and restores horizontal and vertical scrolling", async ({ page, request }) => {
    const fixture = await request.get(`${agentBaseURL}/e2e/project`)
    const envelope = await fixture.json() as { data?: { cinemaURL?: string } }
    expect((await request.post(`${agentBaseURL}/e2e/reset`)).ok()).toBe(true)
    await page.addInitScript(() => {
      window.addEventListener("DOMContentLoaded", () => {
        const style = document.createElement("style")
        style.textContent = ".cinema-timeline-scroll-region { max-height: 110px !important; }"
        document.head.append(style)
      })
    })
    await page.goto(envelope.data!.cinemaURL!)
    await page.getByRole("tab", { name: "Edit" }).click()
    await page.getByRole("button", { name: "New Timeline" }).first().click()
    await page.getByRole("tab", { name: "Outputs" }).click()
    await page.getByRole("button", { name: "视频" }).click()
    for (let index = 1; index <= 3; index += 1) {
      await page.locator(".cinema-timeline-asset-row").filter({ hasText: `Fixture video ${index}` }).dblclick()
      await expect(page.locator(".cinema-timeline-clip")).toHaveCount(index)
    }
    await expect(page.getByText("Saved", { exact: true })).toBeVisible()

    const scrollRegion = page.locator(".cinema-timeline-scroll-region")
    await scrollRegion.evaluate((element) => {
      element.scrollLeft = 260
      element.scrollTop = 42
    })
    await expect.poll(() => scrollRegion.evaluate((element) => element.scrollLeft)).toBe(260)
    await expect.poll(() => scrollRegion.evaluate((element) => element.scrollTop)).toBe(42)

    const regionBox = await scrollRegion.boundingBox()
    const rulerBox = await page.locator(".cinema-timeline-ruler").boundingBox()
    expect(regionBox).not.toBeNull()
    expect(rulerBox).not.toBeNull()
    const anchorX = regionBox!.x + Math.min(520, regionBox!.width * 0.65)
    await page.mouse.click(anchorX, rulerBox!.y + 10)
    const playhead = page.locator(".cinema-timeline-playhead")
    const playheadBeforeZoom = await playhead.boundingBox()
    expect(playheadBeforeZoom).not.toBeNull()

    await page.mouse.move(anchorX, rulerBox!.y + 10)
    await page.keyboard.down("Control")
    await page.mouse.wheel(0, -120)
    await page.keyboard.up("Control")
    await expect.poll(async () => Number(await scrollRegion.getAttribute("data-pixels-per-second"))).toBeGreaterThan(48)
    const playheadAfterZoom = await playhead.boundingBox()
    expect(playheadAfterZoom).not.toBeNull()
    expect(Math.abs(playheadAfterZoom!.x - playheadBeforeZoom!.x)).toBeLessThanOrEqual(1)

    const beforeHorizontalWheel = await scrollRegion.evaluate((element) => element.scrollLeft)
    await page.keyboard.down("Shift")
    await page.mouse.wheel(0, 120)
    await page.keyboard.up("Shift")
    await expect.poll(() => scrollRegion.evaluate((element) => element.scrollLeft)).toBeGreaterThan(beforeHorizontalWheel + 100)

    await scrollRegion.evaluate((element) => {
      element.scrollLeft = 480
      element.scrollTop = 50
    })
    await expect.poll(() => scrollRegion.evaluate((element) => element.scrollLeft)).toBe(480)
    await expect.poll(() => scrollRegion.evaluate((element) => element.scrollTop)).toBe(50)
    await expect.poll(() => page.evaluate(() => {
      const key = Object.keys(localStorage).find((candidate) => candidate.startsWith("anybox:cinema:timeline-ui:"))
      if (!key) return null
      const snapshot = JSON.parse(localStorage.getItem(key) ?? "null") as { scrollLeftPx?: number; scrollTopPx?: number } | null
      return snapshot && { scrollLeftPx: snapshot.scrollLeftPx, scrollTopPx: snapshot.scrollTopPx }
    })).toEqual({ scrollLeftPx: 480, scrollTopPx: 50 })

    await page.reload()
    await page.getByRole("tab", { name: "Edit" }).click()
    const restoredScrollRegion = page.locator(".cinema-timeline-scroll-region")
    await expect.poll(() => restoredScrollRegion.evaluate((element) => element.scrollLeft)).toBe(480)
    await expect.poll(() => restoredScrollRegion.evaluate((element) => element.scrollTop)).toBe(50)

    const zoomIn = page.getByRole("button", { name: "Zoom in" })
    for (let index = 0; index < 4; index += 1) await zoomIn.click()
    await expect(restoredScrollRegion).toHaveAttribute("data-pixels-per-second", "192")
    const tickTimes = await page.locator(".cinema-timeline-ruler span").evaluateAll((ticks) => ticks
      .slice(0, 2)
      .map((tick) => Number((tick as HTMLElement).dataset.rulerTimeUs)))
    expect(tickTimes).toHaveLength(2)
    expect(tickTimes[1]! - tickTimes[0]!).toBe(41_667)

    await restoredScrollRegion.evaluate((element) => { element.scrollLeft = 0 })
    await expect.poll(() => restoredScrollRegion.evaluate((element) => element.scrollLeft)).toBe(0)
    const restoredRegionBox = await restoredScrollRegion.boundingBox()
    const restoredRulerBox = await page.locator(".cinema-timeline-ruler").boundingBox()
    const followStartX = restoredRegionBox!.x + restoredRegionBox!.width * 0.72
    await page.mouse.click(followStartX, restoredRulerBox!.y + 10)
    await page.keyboard.press("l")
    await expect.poll(() => restoredScrollRegion.evaluate((element) => element.scrollLeft), { timeout: 3_000 }).toBeGreaterThan(20)
    await page.keyboard.press("k")
  })
})
