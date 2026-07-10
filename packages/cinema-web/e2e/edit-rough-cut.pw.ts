import { expect, test } from "@playwright/test"

const externalCinemaURL = process.env.CINEMA_E2E_URL
const managedAgentPort = process.env.CINEMA_E2E_AGENT_PORT || "4187"
const agentBaseURL = `http://127.0.0.1:${managedAgentPort}`

test.describe("Cinema Edit rough cut", () => {
  test.skip(Boolean(externalCinemaURL), "Rough-cut assertions use the isolated managed Agent fixture.")

  test("adds three assets, edits, splits, deletes, undoes, redoes, plays, and reloads", async ({ page, request }) => {
    const fixture = await request.get(`${agentBaseURL}/e2e/project`)
    const envelope = await fixture.json() as { data?: { cinemaURL?: string } }
    expect((await request.post(`${agentBaseURL}/e2e/reset`)).ok()).toBe(true)
    await page.goto(envelope.data!.cinemaURL!)
    await page.getByRole("tab", { name: "Edit" }).click()
    await page.getByRole("button", { name: "New Timeline" }).first().click()
    await page.getByRole("tab", { name: "Generated" }).click()
    await page.getByRole("button", { name: "视频" }).click()

    for (let index = 1; index <= 3; index += 1) {
      await page.locator(".cinema-timeline-asset-row").filter({ hasText: `Fixture video ${index}` }).dblclick()
      await expect(page.locator(".cinema-timeline-clip")).toHaveCount(index)
      await expect(page.getByText("Saved", { exact: true })).toBeVisible()
    }

    const firstClip = page.locator(".cinema-timeline-clip").filter({ hasText: "Fixture video 1" }).first()
    const observedCommands: string[] = []
    await page.route(/\/timelines\/[^/]+\/commands$/, async (route) => {
      observedCommands.push((route.request().postDataJSON() as { type: string }).type)
      await route.continue()
    })
    const trimHandle = firstClip.locator(".cinema-timeline-trim-handle.is-end")
    const trimBox = await trimHandle.boundingBox()
    expect(trimBox).not.toBeNull()
    await page.mouse.move(trimBox!.x + trimBox!.width / 2, trimBox!.y + trimBox!.height / 2)
    await page.mouse.down()
    await page.mouse.move(trimBox!.x - 4, trimBox!.y + trimBox!.height / 2, { steps: 8 })
    await page.mouse.up()
    await expect.poll(() => observedCommands.filter((type) => type === "trim-clip").length).toBe(1)

    await firstClip.click()
    const inspector = page.getByRole("complementary", { name: "Timeline inspector" })
    await inspector.getByLabel("Name").fill("Opening still")
    await inspector.getByLabel("Duration (seconds)", { exact: true }).fill("1.5")
    await inspector.getByLabel("Source duration (seconds)", { exact: true }).fill("1.5")
    await inspector.getByRole("button", { name: "Apply" }).click()
    await expect(page.locator(".cinema-timeline-clip").filter({ hasText: "Opening still" })).toHaveCount(1)
    await expect(page.getByText("Saved", { exact: true })).toBeVisible()

    await page.locator(".cinema-timeline-ruler").click({ position: { x: 36, y: 10 } })
    await page.getByRole("button", { name: "Split at playhead" }).click()
    await expect(page.locator(".cinema-timeline-clip")).toHaveCount(4)
    await expect(page.getByText("Saved", { exact: true })).toBeVisible()

    await page.locator(".cinema-timeline-clip").filter({ hasText: "Opening still" }).first().click()
    await page.keyboard.press("Delete")
    await expect(page.locator(".cinema-timeline-clip")).toHaveCount(3)
    await page.keyboard.press("Control+z")
    await expect(page.locator(".cinema-timeline-clip")).toHaveCount(4)
    await page.keyboard.press("Control+Shift+z")
    await expect(page.locator(".cinema-timeline-clip")).toHaveCount(3)
    await page.keyboard.press("Control+z")
    await expect(page.locator(".cinema-timeline-clip")).toHaveCount(4)
    await expect(page.getByText("Saved", { exact: true })).toBeVisible()

    await page.locator(".cinema-timeline-ruler").click({ position: { x: 92, y: 10 } })
    await page.getByRole("button", { name: "Play", exact: true }).click()
    await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible()
    const activeVideo = page.locator(".cinema-timeline-preview-stage video:not(.cinema-timeline-preload-video)")
    await expect.poll(async () => await activeVideo.getAttribute("src"), { timeout: 2_000 })
      .toContain("fixture-video-2")
    await page.getByRole("button", { name: "Pause", exact: true }).click()
    await expect(activeVideo).toBeVisible()

    await page.getByRole("tab", { name: "Create" }).click()
    await expect(page.getByRole("tabpanel", { name: "Create" })).toContainText("Story Brief")
    await page.getByRole("tab", { name: "Edit" }).click()
    await expect(page.locator(".cinema-timeline-clip")).toHaveCount(4)

    await page.reload()
    await page.getByRole("tab", { name: "Edit" }).click()
    await expect(page.locator(".cinema-timeline-clip")).toHaveCount(4)
    await expect(page.locator(".cinema-timeline-clip").filter({ hasText: "Opening still" })).toHaveCount(2)
  })
})
