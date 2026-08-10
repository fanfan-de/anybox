import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

const externalCinemaURL = process.env.CINEMA_E2E_URL
const managedAgentPort = process.env.CINEMA_E2E_AGENT_PORT || "4187"
const agentBaseURL = `http://127.0.0.1:${managedAgentPort}`

test.describe("Cinema Edit workbench", () => {
  test.skip(Boolean(externalCinemaURL), "Edit shell assertions use the isolated managed Agent fixture.")

  test("creates an empty Timeline and preserves desktop layout across themes and width gates", async ({ page, request }, testInfo) => {
    const fixture = await request.get(`${agentBaseURL}/e2e/project`)
    const envelope = await fixture.json() as { data?: { cinemaURL?: string } }
    const cinemaURL = envelope.data?.cinemaURL
    expect(cinemaURL).toBeTruthy()
    expect((await request.post(`${agentBaseURL}/e2e/reset`)).ok()).toBe(true)

    await page.goto(cinemaURL!)
    await page.getByRole("tab", { name: "Edit" }).click()
    await expect(page.getByRole("tabpanel", { name: "Edit" })).toBeVisible()
    await expect(page.getByRole("heading", { name: "No timelines yet" })).toBeVisible()
    await page.getByRole("button", { name: "New Timeline" }).first().click()

    await expect(page.getByRole("heading", { name: "Add media to start editing" })).toBeVisible()
    await expect(page.getByText("V1", { exact: true })).toBeVisible()
    await expect(page.getByText("A1", { exact: true })).toBeVisible()
    await expect(page.getByRole("separator", { name: "Resize preview and Timeline" })).toHaveAttribute("aria-valuenow", "42")

    const timelineGeometry = await page.locator(".cinema-timeline-track").first().evaluate((track) => {
      const header = track.querySelector<HTMLElement>(".cinema-timeline-track-header")!
      const lane = track.querySelector<HTMLElement>(".cinema-timeline-track-lane")!
      const ruler = document.querySelector<HTMLElement>(".cinema-timeline-ruler")!
      const tracks = document.querySelector<HTMLElement>(".cinema-timeline-tracks")!
      return {
        headerWidth: header.getBoundingClientRect().width,
        laneWidth: lane.getBoundingClientRect().width,
        rulerWidth: ruler.getBoundingClientRect().width,
        tracksWidth: tracks.getBoundingClientRect().width,
      }
    })
    expect(Math.abs(timelineGeometry.rulerWidth - timelineGeometry.laneWidth)).toBeLessThan(1)
    expect(Math.abs(timelineGeometry.tracksWidth - timelineGeometry.headerWidth - timelineGeometry.laneWidth)).toBeLessThan(1)

    for (const theme of ["dark", "light"] as const) {
      await page.evaluate((value) => { document.documentElement.dataset.theme = value }, theme)
      const accessibility = await new AxeBuilder({ page }).include(".cinema-edit-workbench").analyze()
      expect(accessibility.violations).toEqual([])
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      if (process.env.CINEMA_E2E_CAPTURE === "1") {
        await page.screenshot({ path: testInfo.outputPath(`cinema-edit-${theme}.png`) })
      }
    }

    for (const width of [1700, 1280, 900, 760]) {
      await page.setViewportSize({ width, height: 760 })
      await expect(page.getByRole("heading", { name: "Add media to start editing" })).toBeVisible()
      await expect(page.getByText("Edit needs a wider desktop window")).toBeHidden()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      expect(await page.locator(".cinema-timeline-scroll-region").evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true)
      if (process.env.CINEMA_E2E_CAPTURE === "1") {
        await page.screenshot({ path: testInfo.outputPath(`cinema-edit-${width}.png`) })
      }
    }

    await page.setViewportSize({ width: 900, height: 760 })
    await page.getByRole("tab", { name: "Outputs" }).click()
    await page.locator(".cinema-timeline-asset-row.is-folder").first().click()
    const firstAssetRow = page.locator(".cinema-timeline-asset-row:not(.is-folder)").first()
    await expect(firstAssetRow).toBeVisible()
    const longNameLayout = await firstAssetRow.evaluate((row) => {
      const label = row.querySelector<HTMLElement>("span")!
      const status = row.querySelector<HTMLElement>("small")!
      label.textContent = "A very long generated asset name that must stay inside the media sidebar without overlapping status controls.mp4"
      const labelRect = label.getBoundingClientRect()
      const statusRect = status.getBoundingClientRect()
      return {
        rowContained: row.scrollWidth <= row.clientWidth,
        labelContained: label.scrollWidth > label.clientWidth,
        noOverlap: labelRect.right <= statusRect.left,
      }
    })
    expect(longNameLayout).toEqual({ rowContained: true, labelContained: true, noOverlap: true })
    expect(await page.locator(".cinema-timeline-media-bin").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)

    await page.setViewportSize({ width: 759, height: 760 })
    await expect(page.getByText("Edit needs a wider desktop window")).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })

  test("keeps subtitle and media inspectors exclusive across compact pane transitions", async ({ page, request }, testInfo) => {
    const fixture = await request.get(`${agentBaseURL}/e2e/project`)
    const envelope = await fixture.json() as { data?: { cinemaURL?: string } }
    expect((await request.post(`${agentBaseURL}/e2e/reset`)).ok()).toBe(true)

    await page.goto(envelope.data!.cinemaURL!)
    await page.getByRole("tab", { name: "Edit" }).click()
    await page.getByRole("button", { name: "New Timeline" }).first().click()
    await page.getByRole("tab", { name: "Outputs" }).click()
    await page.getByRole("button", { name: "视频" }).click()
    await page.locator(".cinema-timeline-asset-row").filter({ hasText: "Fixture video 1" }).dblclick()

    const clip = page.locator(".cinema-timeline-clip").filter({ hasText: "Fixture video 1" })
    await expect(clip).toHaveCount(1)
    await clip.click()
    await expect(page.getByRole("complementary", { name: "Timeline inspector" })).toBeVisible()

    await page.getByRole("tab", { name: "Subtitles" }).click()
    await page.getByRole("button", { name: "Add subtitle track" }).click()
    await expect(page.getByRole("complementary", { name: "Subtitle track" })).toBeVisible()
    await expect(page.getByRole("complementary", { name: "Timeline inspector" })).toHaveCount(0)

    await page.setViewportSize({ width: 1000, height: 760 })
    await expect(page.getByRole("complementary", { name: "Media bin" })).toHaveCount(0)
    await expect(page.getByRole("complementary", { name: "Subtitle track" })).toBeVisible()
    if (process.env.CINEMA_E2E_CAPTURE === "1") {
      await page.screenshot({ path: testInfo.outputPath("cinema-edit-compact-inspector.png") })
    }

    await page.getByRole("button", { name: "Toggle media bin" }).click()
    await expect(page.getByRole("complementary", { name: "Media bin" })).toBeVisible()
    await expect(page.getByRole("complementary", { name: "Subtitle track" })).toHaveCount(0)
    if (process.env.CINEMA_E2E_CAPTURE === "1") {
      await page.screenshot({ path: testInfo.outputPath("cinema-edit-compact-media.png") })
    }
  })
})
