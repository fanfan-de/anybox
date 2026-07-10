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

    for (const theme of ["dark", "light"] as const) {
      await page.evaluate((value) => { document.documentElement.dataset.theme = value }, theme)
      const accessibility = await new AxeBuilder({ page }).include(".cinema-edit-workbench").analyze()
      expect(accessibility.violations).toEqual([])
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      if (process.env.CINEMA_E2E_CAPTURE === "1") {
        await page.screenshot({ path: testInfo.outputPath(`cinema-edit-${theme}.png`) })
      }
    }

    for (const width of [1280, 900, 760]) {
      await page.setViewportSize({ width, height: 760 })
      await expect(page.getByRole("heading", { name: "Add media to start editing" })).toBeVisible()
      await expect(page.getByText("Edit needs a wider desktop window")).toBeHidden()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    }

    await page.setViewportSize({ width: 759, height: 760 })
    await expect(page.getByText("Edit needs a wider desktop window")).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })
})
