import { expect, test } from "@playwright/test"

const externalCinemaURL = process.env.CINEMA_E2E_URL
const managedAgentPort = process.env.CINEMA_E2E_AGENT_PORT || "4187"
const agentBaseURL = `http://127.0.0.1:${managedAgentPort}`

test.describe("Cinema Timeline media readability", () => {
  test.skip(Boolean(externalCinemaURL), "Media assertions use the isolated managed Agent fixture.")

  test("virtualizes filmstrips, applies transforms, coalesces scrub media, and clears gaps or missing media", async ({ page, request }) => {
    const fixture = await request.get(`${agentBaseURL}/e2e/project`)
    const envelope = await fixture.json() as { data: { cinemaURL: string } }
    expect((await request.post(`${agentBaseURL}/e2e/reset`)).ok()).toBe(true)
    const pageErrors: Error[] = []
    page.on("pageerror", (error) => pageErrors.push(error))
    await page.goto(envelope.data.cinemaURL)
    await page.getByRole("tab", { name: "Edit" }).click()
    await page.getByRole("button", { name: "New Timeline" }).first().click()
    await page.getByRole("tab", { name: "Generated" }).click()
    await page.getByRole("button", { name: "视频" }).click()
    for (let index = 1; index <= 2; index += 1) {
      await page.locator(".cinema-timeline-asset-row").filter({ hasText: `Fixture video ${index}` }).dblclick()
      await expect(page.locator(".cinema-timeline-clip")).toHaveCount(index)
    }
    await expect(page.getByText("Saved", { exact: true })).toBeVisible()

    const filmstrips = page.locator(".cinema-timeline-filmstrip")
    await expect(filmstrips).toHaveCount(2)
    await expect(filmstrips.first().locator("img").first()).toBeVisible()
    expect(await page.locator("[data-filmstrip-cell]").count()).toBeLessThan(20)

    const commands: Array<Record<string, unknown> & { type: string }> = []
    await page.route(/\/timelines\/[^/]+\/commands$/, async (route) => {
      commands.push(route.request().postDataJSON() as Record<string, unknown> & { type: string })
      await route.continue()
    })
    let firstClip = page.locator(".cinema-timeline-clip").filter({ hasText: "Fixture video 1" }).first()
    await firstClip.click()
    const inspector = page.getByRole("complementary", { name: "Timeline inspector" })
    await inspector.getByRole("button", { name: "Stretch" }).click()
    await inspector.getByLabel("Position X").fill("96")
    await inspector.getByLabel("Position Y").fill("-54")
    await inspector.getByLabel("Scale").fill("1.1")
    await inspector.getByLabel("Rotation").fill("5")
    await inspector.getByRole("button", { name: "Apply" }).click()
    await expect.poll(() => commands.filter((command) => command.type === "update-clip").length).toBe(1)
    expect(commands.find((command) => command.type === "update-clip")).toMatchObject({
      patch: {
        fit: "stretch",
        transform: { x: 96, y: -54, scale: 1.1, rotationDegrees: 5, anchorX: 0.5, anchorY: 0.5 },
      },
    })

    const ruler = page.locator(".cinema-timeline-ruler")
    await ruler.click({ position: { x: 24, y: 10 } })
    const mainVideo = page.locator(".cinema-timeline-preview-stage > video:not(.cinema-timeline-preload-video)")
    await expect(mainVideo).toBeVisible()
    await expect.poll(() => mainVideo.evaluate((video) => ({
      objectFit: video.style.objectFit,
      transform: video.style.transform,
    }))).toEqual({
      objectFit: "fill",
      transform: "translate(5%, -5%) scale(1.1) rotate(5deg)",
    })

    let previewRequests = 0
    page.on("request", (request) => {
      if (request.url().includes("fixture-video-1/preview")) previewRequests += 1
    })
    const rulerBox = await ruler.boundingBox()
    await page.mouse.move(rulerBox!.x + 8, rulerBox!.y + 10)
    await page.mouse.down()
    await page.mouse.move(rulerBox!.x + 84, rulerBox!.y + 10, { steps: 40 })
    await page.mouse.up()
    await page.waitForTimeout(250)
    expect(previewRequests).toBeLessThanOrEqual(8)
    expect(pageErrors).toEqual([])

    const secondClip = page.locator(".cinema-timeline-clip").filter({ hasText: "Fixture video 2" }).first()
    await secondClip.click()
    await inspector.getByLabel("Position (seconds)").fill("5")
    await inspector.getByRole("button", { name: "Apply" }).click()
    await expect(page.getByText("Saved", { exact: true })).toBeVisible()
    await ruler.click({ position: { x: 144, y: 10 } })
    await expect(mainVideo).toHaveCount(0)
    await expect(page.getByText("No active visual clip", { exact: true })).toBeVisible()

    await page.route(/\/library\/assets\/fixture-video-1$/, async (route) => {
      const response = await route.fetch()
      const body = await response.json() as {
        data?: { asset?: { status?: string }; status?: string }
      }
      const asset = body.data?.asset ?? body.data
      if (asset) asset.status = "missing"
      await route.fulfill({ response, json: body })
    })
    await page.reload()
    await page.getByRole("tab", { name: "Edit" }).click()
    await page.locator(".cinema-timeline-ruler").click({ position: { x: 24, y: 10 } })
    firstClip = page.locator(".cinema-timeline-clip").filter({ hasText: "Fixture video 1" }).first()
    await expect(firstClip).toHaveAttribute("aria-label", /Unavailable · missing/)
    await expect(firstClip.locator(".cinema-timeline-filmstrip")).toHaveClass(/is-unavailable/)
    await expect(firstClip.locator(".cinema-timeline-filmstrip img")).toHaveCount(0)
    await expect(page.getByText("Active media is unavailable", { exact: true })).toBeVisible()
    await expect(page.locator(".cinema-timeline-preview-stage > video:not(.cinema-timeline-preload-video)")).toHaveCount(0)
    expect(pageErrors).toEqual([])
  })
})
