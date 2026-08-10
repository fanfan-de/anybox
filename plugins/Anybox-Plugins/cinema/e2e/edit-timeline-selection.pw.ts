import { expect, test } from "@playwright/test"

const externalCinemaURL = process.env.CINEMA_E2E_URL
const managedAgentPort = process.env.CINEMA_E2E_AGENT_PORT || "4187"
const agentBaseURL = `http://127.0.0.1:${managedAgentPort}`

test.describe("Cinema Timeline selection", () => {
  test.skip(Boolean(externalCinemaURL), "Selection assertions use the isolated managed Agent fixture.")

  test("toggles, clears, marquee-selects, cancels, and restores ordered selection", async ({ page, request }) => {
    const fixture = await request.get(`${agentBaseURL}/e2e/project`)
    const envelope = await fixture.json() as { data?: { cinemaURL?: string } }
    expect((await request.post(`${agentBaseURL}/e2e/reset`)).ok()).toBe(true)
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

    const firstClip = page.locator(".cinema-timeline-clip").filter({ hasText: "Fixture video 1" }).first()
    const secondClip = page.locator(".cinema-timeline-clip").filter({ hasText: "Fixture video 2" }).first()
    const thirdClip = page.locator(".cinema-timeline-clip").filter({ hasText: "Fixture video 3" }).first()
    const lane = page.locator(".cinema-timeline-track-lane").first()

    await firstClip.click()
    await expect(firstClip).toHaveAttribute("aria-pressed", "true")
    await secondClip.click({ modifiers: ["Shift"] })
    await expect(firstClip).toHaveAttribute("aria-pressed", "true")
    await expect(secondClip).toHaveAttribute("aria-pressed", "true")
    await firstClip.click({ modifiers: ["Shift"] })
    await expect(firstClip).toHaveAttribute("aria-pressed", "false")
    await expect(secondClip).toHaveAttribute("aria-pressed", "true")

    const laneBox = await lane.boundingBox()
    expect(laneBox).not.toBeNull()
    await lane.click({ position: { x: 420, y: laneBox!.height - 2 } })
    await expect(firstClip).toHaveAttribute("aria-pressed", "false")
    await expect(secondClip).toHaveAttribute("aria-pressed", "false")
    await expect(thirdClip).toHaveAttribute("aria-pressed", "false")

    const firstBox = await firstClip.boundingBox()
    const secondBox = await secondClip.boundingBox()
    expect(firstBox).not.toBeNull()
    expect(secondBox).not.toBeNull()
    await page.mouse.move(secondBox!.x + secondBox!.width - 2, laneBox!.y + laneBox!.height - 2)
    await page.mouse.down()
    await page.mouse.move(firstBox!.x - 4, laneBox!.y + 4, { steps: 8 })
    await expect(page.locator(".cinema-timeline-marquee")).toBeVisible()
    await expect(firstClip).toHaveAttribute("aria-pressed", "true")
    await expect(secondClip).toHaveAttribute("aria-pressed", "true")
    await expect(thirdClip).toHaveAttribute("aria-pressed", "false")
    await page.mouse.up()
    await expect(page.locator(".cinema-timeline-marquee")).toHaveCount(0)

    const thirdBox = await thirdClip.boundingBox()
    expect(thirdBox).not.toBeNull()
    await page.mouse.move(thirdBox!.x + thirdBox!.width - 2, laneBox!.y + laneBox!.height - 2)
    await page.mouse.down()
    await page.mouse.move(thirdBox!.x + 2, laneBox!.y + 4, { steps: 8 })
    await expect(firstClip).toHaveAttribute("aria-pressed", "false")
    await expect(secondClip).toHaveAttribute("aria-pressed", "false")
    await expect(thirdClip).toHaveAttribute("aria-pressed", "true")
    await page.keyboard.press("Escape")
    await page.mouse.up()
    await expect(firstClip).toHaveAttribute("aria-pressed", "true")
    await expect(secondClip).toHaveAttribute("aria-pressed", "true")
    await expect(thirdClip).toHaveAttribute("aria-pressed", "false")

    await page.waitForTimeout(400)
    await page.reload()
    await page.getByRole("tab", { name: "Edit" }).click()
    await expect(firstClip).toHaveAttribute("aria-pressed", "true")
    await expect(secondClip).toHaveAttribute("aria-pressed", "true")
    await expect(thirdClip).toHaveAttribute("aria-pressed", "false")

    type CommandClip = { id: string; trackID: string; timelineStartUs: number }
    type ObservedCommand = {
      type: string
      placements?: Array<{ clipID: string; timelineStartUs: number }>
      clips?: CommandClip[]
      clipIDs?: string[]
      updates?: Array<{ clipID: string; patch: { volume?: number; opacity?: number; playbackRate?: number } }>
    }
    const moveCommands: ObservedCommand[] = []
    const addCommands: ObservedCommand[] = []
    const deleteCommands: ObservedCommand[] = []
    const updateCommands: ObservedCommand[] = []
    await page.route(/\/timelines\/[^/]+\/commands$/, async (route) => {
      const body = route.request().postDataJSON() as ObservedCommand
      if (body.type === "move-clips") moveCommands.push(body)
      if (body.type === "add-clips") addCommands.push(body)
      if (body.type === "delete-clips") deleteCommands.push(body)
      if (body.type === "update-clips") updateCommands.push(body)
      await route.continue()
    })
    const multiInspector = page.getByRole("complementary", { name: "Timeline inspector" })
    await expect(multiInspector).toContainText("2 Clips")
    await expect(multiInspector.getByLabel("Speed")).toBeVisible()
    await expect(multiInspector.getByLabel("Volume")).toBeVisible()
    await expect(multiInspector.getByLabel("Opacity")).toBeVisible()
    await multiInspector.getByLabel("Volume").fill("0.6")
    await multiInspector.getByRole("button", { name: "Apply" }).click()
    await expect.poll(() => updateCommands.length).toBe(1)
    expect(updateCommands[0]?.updates).toHaveLength(2)
    expect(updateCommands[0]!.updates!.every((update) => update.patch.volume === 0.6)).toBe(true)
    await page.keyboard.press("Control+z")
    await expect.poll(() => updateCommands.length).toBe(2)
    await page.keyboard.press("Control+Shift+z")
    await expect.poll(() => updateCommands.length).toBe(3)

    const beforeFirstMove = await firstClip.boundingBox()
    const beforeSecondMove = await secondClip.boundingBox()
    expect(beforeFirstMove).not.toBeNull()
    expect(beforeSecondMove).not.toBeNull()
    const grabX = beforeFirstMove!.x + beforeFirstMove!.width / 2
    const grabY = beforeFirstMove!.y + beforeFirstMove!.height / 2
    await page.mouse.move(grabX, grabY)
    await page.mouse.down()
    await page.mouse.move(grabX + 288, grabY, { steps: 8 })
    await expect(firstClip).toHaveAttribute("data-pointer-state", "moving")
    await expect(secondClip).toHaveAttribute("data-pointer-state", "moving")
    expect(moveCommands).toHaveLength(0)
    await page.mouse.up()
    await expect.poll(() => moveCommands.length).toBe(1)
    expect(moveCommands[0]?.placements).toHaveLength(2)
    expect(
      moveCommands[0]!.placements![1]!.timelineStartUs
      - moveCommands[0]!.placements![0]!.timelineStartUs,
    ).toBe(2_000_000)
    await expect(firstClip).toHaveAttribute("aria-pressed", "true")
    await expect(secondClip).toHaveAttribute("aria-pressed", "true")
    const afterFirstMove = await firstClip.boundingBox()
    const afterSecondMove = await secondClip.boundingBox()
    expect(afterFirstMove!.x - beforeFirstMove!.x).toBeGreaterThan(287)
    expect(afterFirstMove!.x - beforeFirstMove!.x).toBeLessThan(289)
    expect(afterSecondMove!.x - beforeSecondMove!.x).toBeGreaterThan(287)
    expect(afterSecondMove!.x - beforeSecondMove!.x).toBeLessThan(289)

    await page.keyboard.press("Control+z")
    await expect.poll(() => moveCommands.length).toBe(2)
    const undoneFirst = await firstClip.boundingBox()
    const undoneSecond = await secondClip.boundingBox()
    expect(Math.abs(undoneFirst!.x - beforeFirstMove!.x)).toBeLessThan(1)
    expect(Math.abs(undoneSecond!.x - beforeSecondMove!.x)).toBeLessThan(1)
    await page.keyboard.press("Control+Shift+z")
    await expect.poll(() => moveCommands.length).toBe(3)
    const redoneFirst = await firstClip.boundingBox()
    const redoneSecond = await secondClip.boundingBox()
    expect(Math.abs(redoneFirst!.x - afterFirstMove!.x)).toBeLessThan(1)
    expect(Math.abs(redoneSecond!.x - afterSecondMove!.x)).toBeLessThan(1)

    await page.locator(".cinema-timeline-ruler").click({ position: { x: 672, y: 10 } })
    await page.keyboard.press("Control+c")
    expect(addCommands).toHaveLength(0)
    await page.keyboard.press("Control+v")
    await expect.poll(() => addCommands.length).toBe(1)
    await expect(page.locator(".cinema-timeline-clip")).toHaveCount(5)
    expect(addCommands[0]?.clips).toHaveLength(2)
    expect(addCommands[0]!.clips!.map((clip) => clip.timelineStartUs)).toEqual([14_000_000, 16_000_000])
    expect(new Set(addCommands[0]!.clips!.map((clip) => clip.id)).size).toBe(2)
    const pastedClips = addCommands[0]!.clips!.map((clip) => page.locator(`[data-clip-id="${clip.id}"]`))
    await expect(pastedClips[0]!).toHaveAttribute("aria-pressed", "true")
    await expect(pastedClips[1]!).toHaveAttribute("aria-pressed", "true")
    await expect(firstClip).toHaveAttribute("aria-pressed", "false")
    await expect(secondClip).toHaveAttribute("aria-pressed", "false")

    await page.keyboard.press("Control+d")
    await expect.poll(() => addCommands.length).toBe(2)
    await expect(page.locator(".cinema-timeline-clip")).toHaveCount(7)
    expect(addCommands[1]?.clips).toHaveLength(2)
    expect(addCommands[1]!.clips!.map((clip) => clip.timelineStartUs)).toEqual([18_000_000, 20_000_000])
    const allAddedIDs = addCommands.flatMap((command) => command.clips!.map((clip) => clip.id))
    expect(new Set(allAddedIDs).size).toBe(4)

    await page.keyboard.press("Control+z")
    await expect.poll(() => deleteCommands.length).toBe(1)
    expect(deleteCommands[0]?.clipIDs).toHaveLength(2)
    await expect(page.locator(".cinema-timeline-clip")).toHaveCount(5)
    await page.keyboard.press("Control+z")
    await expect.poll(() => deleteCommands.length).toBe(2)
    expect(deleteCommands[1]?.clipIDs).toHaveLength(2)
    await expect(page.locator(".cinema-timeline-clip")).toHaveCount(3)
    await page.keyboard.press("Control+Shift+z")
    await expect.poll(() => addCommands.length).toBe(3)
    await expect(page.locator(".cinema-timeline-clip")).toHaveCount(5)
  })
})
