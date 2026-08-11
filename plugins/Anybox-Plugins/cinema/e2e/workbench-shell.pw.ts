import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

const externalCinemaURL = process.env.CINEMA_E2E_URL
const managedAgentPort = process.env.CINEMA_E2E_AGENT_PORT || "4187"
const agentBaseURL = `http://127.0.0.1:${managedAgentPort}`

test.describe("Cinema workbench shell", () => {
  test.skip(Boolean(externalCinemaURL), "Workbench shell assertions use the isolated managed Agent fixture.")

  test("keeps Create active and exposes the project Edit and Deliver capabilities", async ({ page, request }, testInfo) => {
    const projectResponse = await request.get(`${agentBaseURL}/e2e/project`)
    expect(projectResponse.ok()).toBe(true)
    const projectEnvelope = await projectResponse.json() as {
      data?: { projectID?: string; cinemaURL?: string }
    }
    const projectID = projectEnvelope.data?.projectID
    const cinemaURL = projectEnvelope.data?.cinemaURL
    expect(projectID).toBeTruthy()
    expect(cinemaURL).toBeTruthy()

    const summaryResponse = await request.get(
      `${agentBaseURL}/api/cinema/projects/${encodeURIComponent(projectID!)}`,
    )
    expect(summaryResponse.ok()).toBe(true)
    const summaryEnvelope = await summaryResponse.json() as { data?: { name?: string } }
    const projectName = summaryEnvelope.data?.name
    expect(projectName).toBeTruthy()

    const resetResponse = await request.post(`${agentBaseURL}/e2e/reset`)
    expect(resetResponse.ok()).toBe(true)
    await page.goto(cinemaURL!)

    const tablist = page.getByRole("tablist", { name: "Cinema workspaces" })
    const createTab = tablist.getByRole("tab", { name: "Create" })
    const editTab = tablist.getByRole("tab", { name: /^Edit/ })
    const deliverTab = tablist.getByRole("tab", { name: /^Deliver/ })

    await expect(page.locator(".cinema-workbench-identity")).toContainText(projectName!)
    await expect(createTab).toHaveAttribute("aria-selected", "true")
    await expect(createTab).toBeEnabled()
    await expect(editTab).toBeEnabled()
    await expect(deliverTab).toBeEnabled()
    await expect(page.getByRole("tabpanel", { name: "Create" })).toContainText("Story Brief")
    await expect(page.locator(".react-flow")).toBeVisible()
    const accessibility = await new AxeBuilder({ page }).include(".cinema-workbench-header").analyze()
    expect(accessibility.violations).toEqual([])

    if (process.env.CINEMA_E2E_CAPTURE === "1") {
      await page.evaluate(() => {
        document.documentElement.dataset.theme = "dark"
      })
      await page.screenshot({ path: testInfo.outputPath("cinema-workbench-shell-dark.png") })
    }

    await page.setViewportSize({ width: 560, height: 720 })
    await expect(tablist).toBeVisible()
    await expect(createTab).toBeVisible()
    await expect(editTab).toBeVisible()
    await expect(deliverTab).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

    if (process.env.CINEMA_E2E_CAPTURE === "1") {
      await page.evaluate(() => {
        document.documentElement.dataset.theme = "light"
      })
      await page.screenshot({ path: testInfo.outputPath("cinema-workbench-shell-light-narrow.png") })
    }
  })

  test("configures Cinema-owned providers from the settings panel", async ({ page, request }, testInfo) => {
    const projectResponse = await request.get(`${agentBaseURL}/e2e/project`)
    expect(projectResponse.ok()).toBe(true)
    const projectEnvelope = await projectResponse.json() as {
      data?: { cinemaURL?: string }
    }
    const cinemaURL = projectEnvelope.data?.cinemaURL
    expect(cinemaURL).toBeTruthy()

    const resetResponse = await request.post(`${agentBaseURL}/e2e/reset`)
    expect(resetResponse.ok()).toBe(true)
    await page.goto(cinemaURL!)

    await page.getByRole("button", { name: "Open settings" }).click()
    await page.getByRole("tab", { name: "Providers" }).click()

    const dialog = page.getByRole("dialog", { name: "Cinema settings" })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole("navigation", { name: "Cinema providers" })).toBeVisible()
    await expect(dialog.getByRole("heading", { name: "Local ComfyUI" })).toBeVisible()
    await expect(dialog.getByLabel("Base URL")).toHaveValue("http://127.0.0.1:8188")
    await expect(dialog.getByText("No key required")).toBeVisible()

    const accessibility = await new AxeBuilder({ page }).include("#cinema-settings-panel").analyze()
    expect(accessibility.violations).toEqual([])

    if (process.env.CINEMA_E2E_CAPTURE === "1") {
      await page.screenshot({ path: testInfo.outputPath("cinema-provider-settings-dark.png") })
    }

    await page.setViewportSize({ width: 520, height: 720 })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole("navigation", { name: "Cinema providers" })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

    if (process.env.CINEMA_E2E_CAPTURE === "1") {
      await page.evaluate(() => {
        document.documentElement.dataset.theme = "light"
      })
      await page.screenshot({ path: testInfo.outputPath("cinema-provider-settings-light-narrow.png") })
    }
  })
})
