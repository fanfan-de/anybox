import { expect, test } from "@playwright/test"

const externalCinemaURL = process.env.CINEMA_E2E_URL
const managedAgentPort = process.env.CINEMA_E2E_AGENT_PORT || "4187"
const agentBaseURL = `http://127.0.0.1:${managedAgentPort}`

test.describe("Cinema subtitle editing", () => {
  test.skip(Boolean(externalCinemaURL), "Subtitle persistence assertions use the isolated managed Agent fixture.")

  test("creates, edits, previews, restores, and delivers a subtitle cue", async ({ page, request }) => {
    const fixture = await request.get(`${agentBaseURL}/e2e/project`)
    const envelope = await fixture.json() as { data: { cinemaURL: string } }
    expect((await request.post(`${agentBaseURL}/e2e/reset`)).ok()).toBe(true)

    await page.goto(envelope.data.cinemaURL)
    await page.getByRole("tab", { name: "Edit" }).click()
    await page.getByRole("button", { name: "New Timeline" }).first().click()
    await page.getByRole("tab", { name: "Subtitles" }).click()

    const subtitlePanel = page.locator(".cinema-subtitles-panel")
    await subtitlePanel.getByRole("button", { name: "Add subtitle", exact: true }).click()
    await subtitlePanel.getByPlaceholder("Enter subtitle text").fill("First subtitle")
    await subtitlePanel.getByRole("button", { name: "Create subtitle" }).click()

    const inspector = page.getByRole("complementary", { name: "Subtitle cue" })
    const previewCue = page.locator(".cinema-timeline-preview-stage .cinema-timeline-subtitle-cue")
    await expect(inspector).toBeVisible()
    await expect(previewCue).toHaveText("First subtitle")
    await expect(page.getByText("Saved", { exact: true })).toBeVisible()

    await inspector.getByLabel("Subtitle text").fill("Edited subtitle")
    await inspector.getByLabel("Speaker").fill("Narrator")
    await inspector.getByRole("button", { name: "Apply" }).click()
    await expect(previewCue).toHaveText("Narrator: Edited subtitle")
    await expect(page.getByText("Saved", { exact: true })).toBeVisible()

    await page.getByRole("button", { name: "Undo", exact: true }).click()
    await expect(previewCue).toHaveText("First subtitle")
    await page.getByRole("button", { name: "Redo", exact: true }).click()
    await expect(previewCue).toHaveText("Narrator: Edited subtitle")

    await inspector.getByLabel("Position").fill("0.5")
    await inspector.getByLabel("Duration").fill("2.25")
    await inspector.getByRole("button", { name: "Apply" }).click()
    await expect(previewCue).toHaveCount(0)
    await subtitlePanel.getByRole("option", { name: /Narrator: Edited subtitle/ }).click()
    await expect(previewCue).toHaveText("Narrator: Edited subtitle")
    await expect(inspector.getByLabel("Position")).toHaveValue("0.5")
    await expect(inspector.getByLabel("Duration")).toHaveValue("2.25")
    await expect(page.getByText("Saved", { exact: true })).toBeVisible()

    await page.reload()
    await page.getByRole("tab", { name: "Edit" }).click()
    await expect(page.getByRole("complementary", { name: "Subtitle cue" })).toBeVisible()
    await expect(page.locator(".cinema-timeline-preview-stage .cinema-timeline-subtitle-cue")).toHaveText("Narrator: Edited subtitle")

    await page.getByRole("tab", { name: /^Deliver/ }).click()
    const subtitles = page.getByLabel("Subtitles")
    await expect(subtitles.locator("option")).toHaveCount(2)
    const preflightResponse = page.waitForResponse((response) => {
      if (!response.url().includes("/delivery-preflight?settings=")) return false
      const settings = new URL(response.url()).searchParams.get("settings")
      return settings?.includes('"mode":"burn-in"') === true
    })
    await subtitles.selectOption({ index: 1 })
    const response = await preflightResponse
    expect(response.ok()).toBe(true)
    const result = (await response.json() as { data: { issues: Array<{ code: string }> } }).data
    expect(result.issues.map((issue) => issue.code)).not.toContain("subtitle-track-invalid")
    expect(result.issues.map((issue) => issue.code)).not.toContain("subtitle-track-empty")
  })
})
