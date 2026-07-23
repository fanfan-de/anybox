import { expect, test, type APIRequestContext, type Page } from "@playwright/test"

const externalCinemaURL = process.env.CINEMA_E2E_URL
const managedAgentPort = process.env.CINEMA_E2E_AGENT_PORT || "4187"
const agentBaseURL = `http://127.0.0.1:${managedAgentPort}`

async function openEditWithAssets(page: Page, request: APIRequestContext) {
  const fixture = await request.get(`${agentBaseURL}/e2e/project`)
  const envelope = await fixture.json() as { data: { cinemaURL: string; projectID: string } }
  expect((await request.post(`${agentBaseURL}/e2e/reset`)).ok()).toBe(true)
  await page.goto(envelope.data.cinemaURL)
  await page.getByRole("tab", { name: "Edit" }).click()
  await page.getByRole("button", { name: "New Timeline" }).first().click()
  await page.getByRole("tab", { name: "Outputs" }).click()
  await page.getByRole("button", { name: "图片" }).click()
  return envelope.data
}

test.describe("Cinema Edit reliability", () => {
  test.skip(Boolean(externalCinemaURL), "Timeline fault injection uses the isolated managed Agent fixture.")

  test("keeps an offline Clip visible, blocks workspace navigation, and saves after Retry", async ({ page, request }) => {
    await openEditWithAssets(page, request)
    let offline = true
    let attempts = 0
    await page.route(/\/timelines\/[^/]+\/commands$/, async (route) => {
      attempts += 1
      if (offline) return await route.abort("internetdisconnected")
      await route.continue()
    })

    await page.locator(".cinema-timeline-asset-row").filter({ hasText: "Fixture image 1" }).dblclick()
    await expect(page.locator(".cinema-timeline-clip")).toHaveCount(1)
    await expect(page.getByText("Save failed", { exact: true })).toBeVisible({ timeout: 8_000 })
    expect(attempts).toBe(3)

    const unload = await page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true }) as BeforeUnloadEvent
      window.dispatchEvent(event)
      return event.defaultPrevented
    })
    expect(unload).toBe(true)
    await page.getByRole("tab", { name: "Create" }).click()
    await expect(page.getByRole("tab", { name: "Edit" })).toHaveAttribute("aria-selected", "true")

    offline = false
    await page.getByRole("button", { name: "Retry" }).click()
    await expect(page.getByText("Saved", { exact: true })).toBeVisible()
    await page.reload()
    await page.getByRole("tab", { name: "Edit" }).click()
    await expect(page.locator(".cinema-timeline-clip")).toHaveCount(1)
  })

  test("rebases an external revision with the same command id", async ({ page, request }) => {
    const project = await openEditWithAssets(page, request)
    const timelinesResponse = await request.get(`${agentBaseURL}/api/cinema/projects/${encodeURIComponent(project.projectID)}/timelines`)
    const timelinesEnvelope = await timelinesResponse.json() as { data: { timelines: Array<{ id: string }> } }
    const timelineID = timelinesEnvelope.data.timelines[0]!.id
    const external = await request.post(`${agentBaseURL}/api/cinema/projects/${encodeURIComponent(project.projectID)}/timelines/${timelineID}/commands`, {
      data: {
        id: "external-marker",
        timelineID,
        baseRevision: 0,
        actor: "e2e-external",
        type: "add-marker",
        marker: { id: "external-marker", timeUs: 0, title: "External", color: "default" },
      },
    })
    expect(external.ok()).toBe(true)

    const observed: Array<{ id: string; baseRevision: number }> = []
    await page.route(/\/timelines\/[^/]+\/commands$/, async (route) => {
      const command = route.request().postDataJSON() as { id: string; baseRevision: number }
      observed.push(command)
      await route.continue()
    })
    await page.locator(".cinema-timeline-asset-row").filter({ hasText: "Fixture image 1" }).dblclick()
    await expect(page.getByText("Saved", { exact: true })).toBeVisible()
    await expect.poll(() => observed.length).toBeGreaterThanOrEqual(3)
    expect(observed[0]?.baseRevision).toBe(0)
    expect(observed[1]?.baseRevision).toBe(1)
    expect(observed[1]?.id).toBe(observed[0]?.id)
  })

  test("keeps a trashed asset Clip and repairs it with a compatible replacement", async ({ page, request }) => {
    const project = await openEditWithAssets(page, request)
    await page.locator(".cinema-timeline-asset-row").filter({ hasText: "Fixture image 1" }).dblclick()
    await expect(page.getByText("Saved", { exact: true })).toBeVisible()

    const stateResponse = await request.get(`${agentBaseURL}/api/cinema/projects/${encodeURIComponent(project.projectID)}/library/state`)
    const stateEnvelope = await stateResponse.json() as { data: { revision: number } }
    const trash = await request.post(`${agentBaseURL}/api/cinema/projects/${encodeURIComponent(project.projectID)}/library/trash`, {
      data: {
        baseRevision: stateEnvelope.data.revision,
        operationID: "e2e-trash-fixture-image-1",
        entries: [{ entryType: "asset", assetID: "fixture-image-1" }],
      },
    })
    expect(trash.ok()).toBe(true)

    await page.reload()
    await page.getByRole("tab", { name: "Edit" }).click()
    const clip = page.locator(".cinema-timeline-clip").filter({ hasText: "Fixture image 1" })
    await expect(clip).toHaveCount(1)
    await expect(clip).toHaveClass(/is-asset-unavailable/)
    await clip.click()
    const inspector = page.getByRole("complementary", { name: "Timeline inspector" })
    await expect(inspector.getByText("Asset: trashed")).toBeVisible()
    await inspector.getByRole("button", { name: "Replace asset" }).click()
    await page.getByRole("button", { name: "产出" }).click()
    await page.getByRole("button", { name: "图片" }).click()
    await page.locator(".cinema-timeline-asset-row").filter({ hasText: "Fixture image 2" }).dblclick()
    await expect(page.getByText("Saved", { exact: true })).toBeVisible()
    await expect(clip).not.toHaveClass(/is-asset-unavailable/)
    await expect(inspector.getByText("Asset: ready")).toBeVisible()

    const repairedState = await request.get(`${agentBaseURL}/api/cinema/projects/${encodeURIComponent(project.projectID)}/library/state`)
    const repairedEnvelope = await repairedState.json() as { data: { revision: number } }
    const rename = await request.patch(`${agentBaseURL}/api/cinema/projects/${encodeURIComponent(project.projectID)}/library/assets/fixture-image-2`, {
      data: { baseRevision: repairedEnvelope.data.revision, operationID: "e2e-rename-replacement", baseName: "Renamed replacement" },
    })
    expect(rename.ok()).toBe(true)
    await page.reload()
    await page.getByRole("tab", { name: "Edit" }).click()
    await expect(page.locator(".cinema-timeline-clip").filter({ hasText: "Fixture image 1" })).not.toHaveClass(/is-asset-unavailable/)
  })
})
