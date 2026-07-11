import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

const externalCinemaURL = process.env.CINEMA_E2E_URL
const managedAgentPort = process.env.CINEMA_E2E_AGENT_PORT || "4187"
const agentBaseURL = `http://127.0.0.1:${managedAgentPort}`

test.describe("Cinema Edit Post-MVP acceptance", () => {
  test.skip(Boolean(externalCinemaURL), "Post-MVP assertions use the isolated managed Agent fixture.")

  test("completes a keyboard-first 10 Clip rough cut and passes populated layout accessibility", async ({ page, request }) => {
    const fixture = await request.get(`${agentBaseURL}/e2e/project`)
    const envelope = await fixture.json() as { data?: { cinemaURL?: string } }
    expect((await request.post(`${agentBaseURL}/e2e/reset`)).ok()).toBe(true)
    await page.goto(envelope.data!.cinemaURL!)
    await page.getByRole("tab", { name: "Edit" }).click()
    await page.getByRole("button", { name: "New Timeline" }).first().click()
    await page.getByRole("tab", { name: "Generated" }).click()
    await page.getByRole("button", { name: "视频" }).click()

    const sequence = [1, 2, 3, 1, 2, 3, 1, 2, 3, 1]
    for (const [index, assetIndex] of sequence.entries()) {
      await page.locator(".cinema-timeline-asset-row").filter({ hasText: `Fixture video ${assetIndex}` }).dblclick()
      await expect(page.locator(".cinema-timeline-clip")).toHaveCount(index + 1)
    }
    await expect(page.getByText("Saved", { exact: true })).toBeVisible()

    const observedCommands: string[] = []
    await page.route(/\/timelines\/[^/]+\/commands$/, async (route) => {
      observedCommands.push((route.request().postDataJSON() as { type: string }).type)
      await route.continue()
    })

    const firstClip = page.locator(".cinema-timeline-clip").first()
    const trimHandle = firstClip.locator(".cinema-timeline-trim-handle.is-end")
    const trimBox = await trimHandle.boundingBox()
    await page.mouse.move(trimBox!.x + trimBox!.width / 2, trimBox!.y + trimBox!.height / 2)
    await page.mouse.down()
    await page.mouse.move(trimBox!.x - 12, trimBox!.y + trimBox!.height / 2, { steps: 6 })
    await page.mouse.up()
    await expect.poll(() => observedCommands.filter((type) => type === "trim-clip").length).toBe(1)

    const secondClip = page.locator(".cinema-timeline-clip").nth(1)
    await secondClip.click()
    await page.locator(".cinema-timeline-ruler").click({ position: { x: 120, y: 10 } })
    await page.keyboard.press("s")
    await expect(page.locator(".cinema-timeline-clip")).toHaveCount(11)
    await expect.poll(() => observedCommands.filter((type) => type === "split-clip").length).toBe(1)

    await page.locator(".cinema-timeline-clip").nth(2).click()
    await page.keyboard.press("Delete")
    await expect(page.locator(".cinema-timeline-clip")).toHaveCount(10)
    await page.keyboard.press("Control+z")
    await expect(page.locator(".cinema-timeline-clip")).toHaveCount(11)
    await page.keyboard.press("Control+Shift+z")
    await expect(page.locator(".cinema-timeline-clip")).toHaveCount(10)

    await page.locator(".cinema-timeline-ruler").click({ position: { x: 210, y: 10 } })
    await page.keyboard.press("Space")
    await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible()
    await expect(page.locator(".cinema-timeline-preview-stage video:not(.cinema-timeline-preload-video)")).toBeVisible()
    await page.keyboard.press("Space")
    await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible()

    for (const theme of ["dark", "light"] as const) {
      await page.evaluate((value) => { document.documentElement.dataset.theme = value }, theme)
      const accessibility = await new AxeBuilder({ page }).include(".cinema-edit-workbench").analyze()
      expect(accessibility.violations).toEqual([])
    }
    for (const width of [1700, 1280, 900, 760]) {
      await page.setViewportSize({ width, height: 760 })
      await expect(page.getByRole("region", { name: "Timeline editor" })).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      expect(await page.locator(".cinema-timeline-scroll-region").evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true)
    }

    await page.reload()
    await page.getByRole("tab", { name: "Edit" }).click()
    await expect(page.locator(".cinema-timeline-clip")).toHaveCount(10)
    await expect(page.getByText("Saved", { exact: true })).toBeVisible()
  })
})
