import { expect, test } from "@playwright/test"

const externalCinemaURL = process.env.CINEMA_E2E_URL
const managedAgentPort = process.env.CINEMA_E2E_AGENT_PORT || "4187"
const agentBaseURL = `http://127.0.0.1:${managedAgentPort}`

test.describe("Cinema Timeline pointer interaction", () => {
  test.skip(Boolean(externalCinemaURL), "Pointer assertions use the isolated managed Agent fixture.")

  test("moves with a stable grab offset, commits once, and cancels with Escape", async ({ page, request }) => {
    const fixture = await request.get(`${agentBaseURL}/e2e/project`)
    const envelope = await fixture.json() as { data?: { cinemaURL?: string } }
    expect((await request.post(`${agentBaseURL}/e2e/reset`)).ok()).toBe(true)
    await page.goto(envelope.data!.cinemaURL!)
    await page.getByRole("tab", { name: "Edit" }).click()
    await page.getByRole("button", { name: "New Timeline" }).first().click()
    await page.getByRole("tab", { name: "Generated" }).click()
    await page.getByRole("button", { name: "视频" }).click()
    await page.locator(".cinema-timeline-asset-row").filter({ hasText: "Fixture video 1" }).dblclick()
    await page.locator(".cinema-timeline-asset-row").filter({ hasText: "Fixture video 2" }).dblclick()
    await expect(page.getByText("Saved", { exact: true })).toBeVisible()

    const moveCommands: Array<{ type: string; timelineStartUs?: number }> = []
    const trimCommands: Array<{ type: string }> = []
    await page.route(/\/timelines\/[^/]+\/commands$/, async (route) => {
      const body = route.request().postDataJSON() as { type: string; timelineStartUs?: number }
      if (body.type === "move-clip") moveCommands.push(body)
      if (body.type === "trim-clip") trimCommands.push(body)
      await route.continue()
    })

    const clip = page.locator(".cinema-timeline-clip").filter({ hasText: "Fixture video 1" }).first()
    const originalBox = await clip.boundingBox()
    expect(originalBox).not.toBeNull()
    const grabX = originalBox!.x + originalBox!.width * 0.72
    const grabY = originalBox!.y + originalBox!.height / 2
    const moveDelta = 240

    await page.mouse.move(grabX, grabY)
    await page.mouse.down()
    await expect(clip).toHaveAttribute("data-pointer-state", "moving")
    const grabbedBox = await clip.boundingBox()
    expect(Math.abs(grabbedBox!.x - originalBox!.x)).toBeLessThan(1)

    await page.mouse.move(grabX + moveDelta, grabY, { steps: 8 })
    expect(moveCommands).toHaveLength(0)
    await expect.poll(async () => {
      const draftBox = await clip.boundingBox()
      return draftBox ? draftBox.x - originalBox!.x : Number.NaN
    }).toBeGreaterThan(moveDelta - 2)
    const draftBox = await clip.boundingBox()
    expect(draftBox!.x - originalBox!.x).toBeLessThan(moveDelta + 2)

    await page.mouse.up()
    await expect.poll(() => moveCommands.length).toBe(1)
    expect(moveCommands[0]?.timelineStartUs).toBeGreaterThan(4_900_000)
    expect(moveCommands[0]?.timelineStartUs).toBeLessThan(5_100_000)
    await expect(page.getByText("Saved", { exact: true })).toBeVisible()

    const committedBox = await clip.boundingBox()
    expect(committedBox).not.toBeNull()
    const cancelGrabX = committedBox!.x + committedBox!.width * 0.65
    const cancelGrabY = committedBox!.y + committedBox!.height / 2
    await page.mouse.move(cancelGrabX, cancelGrabY)
    await page.mouse.down()
    await page.mouse.move(cancelGrabX + 80, cancelGrabY, { steps: 6 })
    await expect(clip).toHaveAttribute("data-pointer-state", "moving")
    expect(moveCommands).toHaveLength(1)

    await page.keyboard.press("Escape")
    await expect(clip).toHaveAttribute("data-pointer-state", "idle")
    await expect(clip).toHaveAttribute("aria-pressed", "true")
    await page.mouse.up()
    await page.waitForTimeout(100)
    expect(moveCommands).toHaveLength(1)
    const cancelledBox = await clip.boundingBox()
    expect(Math.abs(cancelledBox!.x - committedBox!.x)).toBeLessThan(1)

    const scrollRegion = page.locator(".cinema-timeline-scroll-region")
    for (const cancelKind of ["pointercancel", "blur"] as const) {
      const beforeCancelBox = await clip.boundingBox()
      const pointerX = beforeCancelBox!.x + beforeCancelBox!.width / 2
      const pointerY = beforeCancelBox!.y + beforeCancelBox!.height / 2
      await page.mouse.move(pointerX, pointerY)
      await page.mouse.down()
      await page.mouse.move(pointerX + 60, pointerY, { steps: 6 })
      await expect(clip).toHaveAttribute("data-pointer-state", "moving")
      if (cancelKind === "pointercancel") {
        await scrollRegion.dispatchEvent("pointercancel", { pointerId: 1, bubbles: true })
      } else {
        await page.evaluate(() => window.dispatchEvent(new Event("blur")))
      }
      await expect(clip).toHaveAttribute("data-pointer-state", "idle")
      await page.mouse.up()
      expect(moveCommands).toHaveLength(1)
      const afterCancelBox = await clip.boundingBox()
      expect(Math.abs(afterCancelBox!.x - beforeCancelBox!.x)).toBeLessThan(1)
    }

    const scrollRegionBox = await scrollRegion.boundingBox()
    const autoScrollClipBox = await clip.boundingBox()
    const autoScrollGrabX = autoScrollClipBox!.x + autoScrollClipBox!.width / 2
    const autoScrollGrabY = autoScrollClipBox!.y + autoScrollClipBox!.height / 2
    const edgePointerX = scrollRegionBox!.x + scrollRegionBox!.width - 6
    await page.mouse.move(autoScrollGrabX, autoScrollGrabY)
    await page.mouse.down()
    await page.mouse.move(edgePointerX, autoScrollGrabY, { steps: 8 })
    await expect.poll(() => scrollRegion.evaluate((element) => element.scrollLeft)).toBeGreaterThan(80)
    const autoScrolledDraftBox = await clip.boundingBox()
    expect(Math.abs(autoScrolledDraftBox!.x + autoScrolledDraftBox!.width / 2 - edgePointerX)).toBeLessThan(3)
    expect(moveCommands).toHaveLength(1)
    await page.keyboard.press("Escape")
    await page.mouse.up()
    expect(moveCommands).toHaveLength(1)
    await scrollRegion.evaluate((element) => { element.scrollLeft = 0 })
    await expect.poll(() => scrollRegion.evaluate((element) => element.scrollLeft)).toBe(0)

    const incompatibleClipBox = await clip.boundingBox()
    const audioLaneBox = await page.locator(".cinema-timeline-track-lane").nth(1).boundingBox()
    await page.mouse.move(
      incompatibleClipBox!.x + incompatibleClipBox!.width / 2,
      incompatibleClipBox!.y + incompatibleClipBox!.height / 2,
    )
    await page.mouse.down()
    await page.mouse.move(
      incompatibleClipBox!.x + incompatibleClipBox!.width / 2,
      audioLaneBox!.y + audioLaneBox!.height / 2,
      { steps: 6 },
    )
    await expect(clip).toHaveClass(/is-invalid-drop/)
    await page.mouse.up()
    await expect(clip).not.toHaveClass(/is-invalid-drop/)
    expect(moveCommands).toHaveLength(1)

    await page.locator(".cinema-timeline-ruler").click({ position: { x: 312, y: 10 } })
    const trimHandle = clip.locator(".cinema-timeline-trim-handle.is-end")
    const trimHandleBox = await trimHandle.boundingBox()
    const beforeTrimBox = await clip.boundingBox()
    expect(trimHandleBox).not.toBeNull()
    expect(beforeTrimBox).not.toBeNull()
    await page.mouse.move(trimHandleBox!.x + trimHandleBox!.width / 2, trimHandleBox!.y + trimHandleBox!.height / 2)
    await page.mouse.down()
    await page.mouse.move(trimHandleBox!.x - 24, trimHandleBox!.y + trimHandleBox!.height / 2, { steps: 6 })
    await expect(clip).toHaveAttribute("data-pointer-state", "trimming")
    expect(trimCommands).toHaveLength(0)
    await expect(page.locator(".cinema-timeline-snap-guide")).toHaveAttribute("data-snap-time-us", "6500000")
    const trimDraftBox = await clip.boundingBox()
    expect(beforeTrimBox!.width - trimDraftBox!.width).toBeGreaterThan(22)

    await page.keyboard.press("Escape")
    await expect(clip).toHaveAttribute("data-pointer-state", "idle")
    await page.mouse.up()
    await page.waitForTimeout(100)
    expect(trimCommands).toHaveLength(0)
    await expect(page.locator(".cinema-timeline-snap-guide")).toHaveCount(0)
    const cancelledTrimBox = await clip.boundingBox()
    expect(Math.abs(cancelledTrimBox!.width - beforeTrimBox!.width)).toBeLessThan(1)

    const beforeSnapBox = await clip.boundingBox()
    const snapGrabX = beforeSnapBox!.x + beforeSnapBox!.width / 2
    const snapGrabY = beforeSnapBox!.y + beforeSnapBox!.height / 2
    await page.mouse.move(snapGrabX, snapGrabY)
    await page.mouse.down()
    await page.mouse.move(snapGrabX - 140, snapGrabY, { steps: 8 })
    const snapGuide = page.locator(".cinema-timeline-snap-guide")
    await expect(snapGuide).toHaveAttribute("data-snap-time-us", "2000000")
    await expect(snapGuide).toContainText("00:00:02.000")
    const snappedBox = await clip.boundingBox()
    expect(beforeSnapBox!.x - snappedBox!.x).toBeGreaterThan(143)
    expect(beforeSnapBox!.x - snappedBox!.x).toBeLessThan(145)
    expect(moveCommands).toHaveLength(1)
    await page.keyboard.press("Escape")
    await page.mouse.up()
    await expect(snapGuide).toHaveCount(0)
    expect(moveCommands).toHaveLength(1)

    const ruler = page.locator(".cinema-timeline-ruler")
    const playhead = page.locator(".cinema-timeline-playhead")
    const rulerBox = await ruler.boundingBox()
    const initialPlayheadBox = await playhead.boundingBox()
    expect(rulerBox).not.toBeNull()
    expect(initialPlayheadBox).not.toBeNull()
    await page.mouse.move(rulerBox!.x + 70, rulerBox!.y + 10)
    await page.mouse.down()
    await page.mouse.move(rulerBox!.x + 150, rulerBox!.y + 10, { steps: 8 })
    await expect(playhead).toHaveAttribute("data-pointer-state", "scrubbing")
    const scrubDraftBox = await playhead.boundingBox()
    expect(Math.abs((scrubDraftBox!.x + scrubDraftBox!.width / 2) - (rulerBox!.x + 150))).toBeLessThan(2)
    expect(moveCommands).toHaveLength(1)
    expect(trimCommands).toHaveLength(0)

    await page.keyboard.press("Escape")
    await page.mouse.up()
    const cancelledScrubBox = await playhead.boundingBox()
    expect(Math.abs(cancelledScrubBox!.x - initialPlayheadBox!.x)).toBeLessThan(1)

    const playheadGrabBox = await playhead.boundingBox()
    const playheadGrabX = playheadGrabBox!.x + playheadGrabBox!.width / 2
    const playheadGrabY = playheadGrabBox!.y + 3
    await page.mouse.move(playheadGrabX, playheadGrabY)
    await page.mouse.down()
    await page.mouse.move(playheadGrabX + 70, playheadGrabY, { steps: 7 })
    await expect(playhead).toHaveAttribute("data-pointer-state", "scrubbing")
    await page.mouse.up()
    await expect(playhead).toHaveAttribute("data-pointer-state", "idle")
    const committedScrubBox = await playhead.boundingBox()
    expect(Math.abs(committedScrubBox!.x - playheadGrabBox!.x - 70)).toBeLessThan(2)
    expect(moveCommands).toHaveLength(1)
    expect(trimCommands).toHaveLength(0)

    const beforeUndoBox = await clip.boundingBox()
    await page.keyboard.press("Control+z")
    await expect.poll(() => moveCommands.length).toBe(2)
    const undoneBox = await clip.boundingBox()
    expect(beforeUndoBox!.x - undoneBox!.x).toBeGreaterThan(239)
    expect(beforeUndoBox!.x - undoneBox!.x).toBeLessThan(241)
    await page.keyboard.press("Control+Shift+z")
    await expect.poll(() => moveCommands.length).toBe(3)
    const redoneBox = await clip.boundingBox()
    expect(Math.abs(redoneBox!.x - beforeUndoBox!.x)).toBeLessThan(1)
  })
})
