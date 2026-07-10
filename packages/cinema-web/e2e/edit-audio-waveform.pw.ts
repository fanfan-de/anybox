import { expect, test } from "@playwright/test"

const externalCinemaURL = process.env.CINEMA_E2E_URL
const managedAgentPort = process.env.CINEMA_E2E_AGENT_PORT || "4187"
const agentBaseURL = `http://127.0.0.1:${managedAgentPort}`

test.describe("Cinema Edit audio and Timeline management", () => {
  test.skip(Boolean(externalCinemaURL), "Audio fixture assertions use the isolated managed Agent fixture.")

  test("derives a cached waveform, persists fades and track state, and deletes a Timeline", async ({ page, request }) => {
    const fixture = await request.get(`${agentBaseURL}/e2e/project`)
    const envelope = await fixture.json() as { data: { cinemaURL: string; projectID: string } }
    expect((await request.post(`${agentBaseURL}/e2e/reset`)).ok()).toBe(true)
    await page.goto(envelope.data.cinemaURL)
    await page.getByRole("tab", { name: "Edit" }).click()
    await page.getByRole("button", { name: "New Timeline" }).first().click()
    await page.getByRole("tab", { name: "Generated" }).click()
    await page.getByRole("button", { name: "音频" }).click()
    await page.locator(".cinema-timeline-asset-row").filter({ hasText: "Fixture audio 1" }).dblclick()
    await expect(page.getByText("Saved", { exact: true })).toBeVisible()
    const timelines = await request.get(`${agentBaseURL}/api/cinema/projects/${encodeURIComponent(envelope.data.projectID)}/timelines`)
    const timelinesBody = await timelines.json() as { data: { timelines: Array<{ id: string; clips: Array<{ id: string }> }> } }
    const timeline = timelinesBody.data.timelines[0]!
    const waveformResponse = await request.get(`${agentBaseURL}/api/cinema/projects/${encodeURIComponent(envelope.data.projectID)}/timelines/${timeline.id}/clips/${timeline.clips[0]!.id}/waveform`)
    expect(waveformResponse.ok(), await waveformResponse.text()).toBe(true)
    await expect(page.locator(".cinema-timeline-waveform")).toBeVisible({ timeout: 15_000 })

    const clip = page.locator(".cinema-timeline-clip").filter({ hasText: "Fixture audio 1" })
    await clip.click()
    const inspector = page.getByRole("complementary", { name: "Timeline inspector" })
    await inspector.getByLabel("Fade in µs").fill("250000")
    await inspector.getByLabel("Fade out µs").fill("500000")
    await inspector.getByRole("button", { name: "Apply" }).click()
    await page.getByRole("button", { name: "A1 mute" }).click()
    await expect(page.getByRole("button", { name: "A1 mute" })).toHaveAttribute("aria-pressed", "true")
    await expect(page.getByText("Saved", { exact: true })).toBeVisible()

    await page.reload()
    await page.getByRole("tab", { name: "Edit" }).click()
    await page.locator(".cinema-timeline-clip").filter({ hasText: "Fixture audio 1" }).click()
    await expect(page.getByLabel("Fade in µs")).toHaveValue("250000")
    await expect(page.getByLabel("Fade out µs")).toHaveValue("500000")
    await expect(page.getByRole("button", { name: "A1 mute" })).toHaveAttribute("aria-pressed", "true")

    await page.getByRole("tab", { name: "Timelines" }).click()
    page.once("dialog", (dialog) => void dialog.accept())
    await page.getByTitle("Delete Timeline").click()
    await expect(page.getByText("No timelines", { exact: true })).toBeVisible()
  })
})
