import { expect, test } from "@playwright/test"

const externalCinemaURL = process.env.CINEMA_E2E_URL
const managedAgentPort = process.env.CINEMA_E2E_AGENT_PORT || "4187"
const agentBaseURL = `http://127.0.0.1:${managedAgentPort}`

test.describe("Cinema Edit performance", () => {
  test.skip(Boolean(externalCinemaURL), "Performance fixture uses the isolated managed Agent.")

  test("opens 500 Clips under one second and virtualizes the Track DOM", async ({ page, request }) => {
    const fixture = await request.get(`${agentBaseURL}/e2e/project`)
    const envelope = await fixture.json() as { data: { cinemaURL: string } }
    expect((await request.post(`${agentBaseURL}/e2e/reset`)).ok()).toBe(true)
    expect((await request.post(`${agentBaseURL}/e2e/seed-large-timeline`)).ok()).toBe(true)
    await page.goto(envelope.data.cinemaURL)

    const started = Date.now()
    await page.getByRole("tab", { name: "Edit" }).click()
    await expect(page.getByText("500 Clip performance", { exact: true }).first()).toBeVisible()
    const elapsed = Date.now() - started
    expect(elapsed).toBeLessThan(1000)

    const clips = page.locator(".cinema-timeline-clip")
    expect(await clips.count()).toBeLessThan(30)
    expect(await page.locator("[data-filmstrip-cell]").count()).toBeLessThan(40)
    await expect(clips.first()).toHaveAttribute("data-clip-id", "large-clip-0")

    const scrollRegion = page.locator(".cinema-timeline-scroll-region")
    await scrollRegion.evaluate((element) => { element.scrollLeft = element.scrollWidth - element.clientWidth })
    await expect.poll(() => clips.count()).toBeLessThan(30)
    await expect.poll(() => page.locator("[data-filmstrip-cell]").count()).toBeLessThan(40)
    await expect(page.locator('[data-clip-id="large-clip-499"]')).toBeVisible()

    const session = await page.context().newCDPSession(page)
    await session.send("Performance.enable")
    const metrics = await session.send("Performance.getMetrics")
    const metric = (name: string) => metrics.metrics.find((candidate) => candidate.name === name)?.value ?? Number.POSITIVE_INFINITY
    expect(metric("Nodes")).toBeLessThan(5_000)
    expect(metric("JSHeapUsedSize")).toBeLessThan(128 * 1024 * 1024)
  })
})
