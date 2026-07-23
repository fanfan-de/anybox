import { expect, test } from "@playwright/test"

const externalCinemaURL = process.env.CINEMA_E2E_URL
const managedAgentPort = process.env.CINEMA_E2E_AGENT_PORT || "4187"
const agentBaseURL = `http://127.0.0.1:${managedAgentPort}`

test.describe("Cinema Timeline keyboard shortcuts", () => {
  test.skip(Boolean(externalCinemaURL), "Shortcut command assertions use the isolated managed Agent fixture.")

  test("supports edit shortcuts without hijacking editable controls", async ({ page, request }) => {
    const fixture = await request.get(`${agentBaseURL}/e2e/project`)
    const envelope = await fixture.json() as { data?: { cinemaURL?: string } }
    expect((await request.post(`${agentBaseURL}/e2e/reset`)).ok()).toBe(true)
    await page.goto(envelope.data!.cinemaURL!)
    await page.getByRole("tab", { name: "Edit" }).click()
    await page.getByRole("button", { name: "New Timeline" }).first().click()
    await page.getByRole("tab", { name: "Outputs" }).click()
    await page.getByRole("button", { name: "视频" }).click()
    await page.locator(".cinema-timeline-asset-row").filter({ hasText: "Fixture video 1" }).dblclick()
    await expect(page.locator(".cinema-timeline-clip")).toHaveCount(1)
    await expect(page.getByText("Saved", { exact: true })).toBeVisible()

    const commands: Array<Record<string, unknown> & { type: string }> = []
    await page.route(/\/timelines\/[^/]+\/commands$/, async (route) => {
      commands.push(route.request().postDataJSON() as Record<string, unknown> & { type: string })
      await route.continue()
    })
    const clip = page.locator(".cinema-timeline-clip").filter({ hasText: "Fixture video 1" }).first()
    await clip.click()
    const nameInput = page.getByRole("complementary", { name: "Timeline inspector" }).getByLabel("Name")
    await nameInput.focus()
    await page.keyboard.press("Control+s")
    await page.keyboard.press("Control+d")
    await page.keyboard.press("Control+z")
    await page.keyboard.press("Delete")
    await page.keyboard.type("s j k l i o ")
    expect(commands).toHaveLength(0)
    await expect(page.locator(".cinema-timeline-clip")).toHaveCount(1)
    await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible()

    await page.evaluate(() => {
      const textarea = document.createElement("textarea")
      textarea.id = "timeline-shortcut-textarea"
      const editable = document.createElement("div")
      editable.id = "timeline-shortcut-contenteditable"
      editable.contentEditable = "true"
      document.body.append(textarea, editable)
    })
    await page.locator("#timeline-shortcut-textarea").focus()
    await page.keyboard.press("Control+d")
    await page.keyboard.press("Delete")
    await page.keyboard.type("s ")
    await page.locator("#timeline-shortcut-contenteditable").focus()
    await page.keyboard.press("Control+d")
    await page.keyboard.press("Delete")
    await page.keyboard.type("s ")
    expect(commands).toHaveLength(0)
    await expect(page.locator(".cinema-timeline-clip")).toHaveCount(1)

    await page.locator(".cinema-timeline-ruler").click({ position: { x: 48, y: 10 } })
    await clip.focus()
    await page.keyboard.press("i")
    await expect.poll(() => commands.filter((command) => command.type === "trim-clip").length).toBe(1)
    expect(commands.find((command) => command.type === "trim-clip")).toMatchObject({
      timelineStartUs: 1_000_000,
      durationUs: 1_000_000,
      sourceInUs: 1_000_000,
      sourceDurationUs: 1_000_000,
    })
    await page.keyboard.press("Control+z")
    await expect.poll(() => commands.filter((command) => command.type === "trim-clip").length).toBe(2)

    await clip.focus()
    await page.keyboard.press("o")
    await expect.poll(() => commands.filter((command) => command.type === "trim-clip").length).toBe(3)
    expect(commands.filter((command) => command.type === "trim-clip")[2]).toMatchObject({
      timelineStartUs: 0,
      durationUs: 1_000_000,
      sourceInUs: 0,
      sourceDurationUs: 1_000_000,
    })
    await page.keyboard.press("Control+z")
    await expect.poll(() => commands.filter((command) => command.type === "trim-clip").length).toBe(4)

    await clip.focus()
    await page.keyboard.press("s")
    await expect.poll(() => commands.filter((command) => command.type === "split-clip").length).toBe(1)
    await expect(page.locator(".cinema-timeline-clip")).toHaveCount(2)
    await page.keyboard.press("Control+z")
    await expect(page.locator(".cinema-timeline-clip")).toHaveCount(1)

    await clip.focus()
    await page.keyboard.press("Delete")
    await expect(page.locator(".cinema-timeline-clip")).toHaveCount(0)
    await page.keyboard.press("Control+z")
    await expect(page.locator(".cinema-timeline-clip")).toHaveCount(1)

    const tracks = page.getByLabel("Timeline tracks")
    await page.locator(".cinema-timeline-ruler").click({ position: { x: 10, y: 10 } })
    await tracks.focus()
    const playhead = page.locator(".cinema-timeline-playhead")
    const beforeArrow = await playhead.boundingBox()
    await page.keyboard.press("ArrowRight")
    const afterFrame = await playhead.boundingBox()
    expect(afterFrame!.x - beforeArrow!.x).toBeGreaterThan(1.5)
    expect(afterFrame!.x - beforeArrow!.x).toBeLessThan(2.5)
    await page.keyboard.press("Shift+ArrowRight")
    const afterSecond = await playhead.boundingBox()
    expect(afterSecond!.x - afterFrame!.x).toBeGreaterThan(47)
    expect(afterSecond!.x - afterFrame!.x).toBeLessThan(49)

    await page.locator(".cinema-timeline-ruler").click({ position: { x: 48, y: 10 } })
    await tracks.focus()
    const beforeForward = await playhead.boundingBox()
    await page.keyboard.press("l")
    await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible()
    await expect.poll(async () => (await playhead.boundingBox())!.x).toBeGreaterThan(beforeForward!.x + 2)
    await page.keyboard.press("k")
    await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible()
    const paused = await playhead.boundingBox()
    await page.waitForTimeout(100)
    expect(Math.abs((await playhead.boundingBox())!.x - paused!.x)).toBeLessThan(1)
    await page.keyboard.press("j")
    await expect.poll(async () => (await playhead.boundingBox())!.x).toBeLessThan(paused!.x - 2)
    await page.keyboard.press("k")
    const beforeSpace = await playhead.boundingBox()
    await page.keyboard.press(" ")
    await expect.poll(async () => (await playhead.boundingBox())!.x).toBeGreaterThan(beforeSpace!.x + 2)
    await page.keyboard.press(" ")
    await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible()
  })
})
