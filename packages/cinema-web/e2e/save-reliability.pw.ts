import { expect, test, type APIRequestContext, type Page } from "@playwright/test"

const externalCinemaURL = process.env.CINEMA_E2E_URL
const managedAgentPort = process.env.CINEMA_E2E_AGENT_PORT || "4187"
const agentBaseURL = `http://127.0.0.1:${managedAgentPort}`

type FixtureProject = {
  projectID: string
  cinemaURL: string
}

async function readFixtureProject(request: APIRequestContext): Promise<FixtureProject> {
  const response = await request.get(`${agentBaseURL}/e2e/project`)
  expect(response.ok()).toBe(true)
  const envelope = await response.json() as { success: boolean; data?: FixtureProject }
  expect(envelope.success).toBe(true)
  expect(envelope.data?.projectID).toBeTruthy()
  expect(envelope.data?.cinemaURL).toBeTruthy()
  return envelope.data!
}

async function openManagedProject(page: Page, request: APIRequestContext) {
  const project = await readFixtureProject(request)
  const reset = await request.post(`${agentBaseURL}/e2e/reset`)
  expect(reset.ok()).toBe(true)
  const initialEvents = page.waitForResponse((response) => response.url().includes("/events?limit=1"))
  await page.goto(project.cinemaURL)
  await initialEvents
  await expect(page.locator(".cinema-save-status")).toContainText("已保存")
  return project
}

async function editStoryBrief(page: Page, value: string) {
  const textNode = page.locator('.react-flow__node-cinemaNode[data-id="story-brief"]')
  await textNode.click()
  await textNode.getByRole("button", { name: "编辑文本" }).click()
  const editor = textNode.locator("textarea.cinema-text-card-editor")
  await editor.fill(value)
  return editor
}

async function startTextGeneration(page: Page, nodeID: string, prompt: string) {
  const textNode = page.locator(`.react-flow__node-cinemaNode[data-id="${nodeID}"]`)
  await textNode.click()
  await textNode.getByRole("button", { name: "生成文本" }).click()
  await page.locator("textarea.cinema-text-card-generator-input").fill(prompt)
  await page.locator("button.cinema-text-card-submit").click()
  return textNode
}

test.describe("Cinema save reliability", () => {
  test.skip(Boolean(externalCinemaURL), "Reliability fault injection uses the isolated managed Agent fixture.")

  test("keeps an offline edit visible and persists it after manual retry", async ({ page, request }) => {
    const project = await openManagedProject(page, request)
    let offline = true
    let commandAttempts = 0
    await page.route(/\/api\/cinema\/projects\/[^/]+\/commands$/, async (route) => {
      commandAttempts += 1
      if (offline) {
        await route.abort("internetdisconnected")
        return
      }
      await route.continue()
    })

    const editor = await editStoryBrief(page, "Draft retained while offline.")
    await expect(page.locator(".cinema-save-status")).toContainText("保存失败", { timeout: 8_000 })
    expect(commandAttempts).toBe(3)
    await expect(editor).toHaveValue("Draft retained while offline.")

    offline = false
    await page.getByRole("button", { name: "重试保存" }).click()
    await expect(page.locator(".cinema-save-status")).toContainText("已保存")

    const canvasResponse = await request.get(
      `${agentBaseURL}/api/cinema/projects/${encodeURIComponent(project.projectID)}/canvas`,
    )
    const canvasEnvelope = await canvasResponse.json() as {
      data?: { nodes?: Array<{ id: string; data?: { text?: string } }> }
    }
    expect(canvasEnvelope.data?.nodes?.find((node) => node.id === "story-brief")?.data?.text)
      .toBe("Draft retained while offline.")
  })

  test("rebases a stale command without changing its id", async ({ page, request }) => {
    const project = await openManagedProject(page, request)
    const observedCommands: Array<{ id: string; baseRevision: number }> = []
    await page.route(/\/api\/cinema\/projects\/[^/]+\/commands$/, async (route) => {
      const body = route.request().postDataJSON() as { id: string; baseRevision: number }
      observedCommands.push({ id: body.id, baseRevision: body.baseRevision })
      await route.continue()
    })

    const externalUpdate = await request.post(
      `${agentBaseURL}/api/cinema/projects/${encodeURIComponent(project.projectID)}/commands`,
      {
        data: {
          id: "external-revision-update",
          type: "update-viewport",
          actor: "e2e-external-writer",
          baseRevision: 0,
          viewport: { x: 40, y: 24, zoom: 0.9 },
        },
      },
    )
    expect(externalUpdate.ok()).toBe(true)

    await editStoryBrief(page, "Rebased after an external update.")
    await expect(page.locator(".cinema-save-status")).toContainText("已保存")
    await expect.poll(() => observedCommands.length).toBeGreaterThanOrEqual(2)
    expect(observedCommands[0]?.baseRevision).toBe(0)
    expect(observedCommands[1]?.baseRevision).toBe(1)
    expect(observedCommands[1]?.id).toBe(observedCommands[0]?.id)
  })

  test("prevents silent navigation while a failed command remains queued", async ({ page, request }) => {
    await openManagedProject(page, request)
    await page.route(/\/api\/cinema\/projects\/[^/]+\/commands$/, (route) => route.abort("internetdisconnected"))
    const editor = await editStoryBrief(page, "Unsaved navigation guard.")
    await expect(page.locator(".cinema-save-status")).toContainText("保存失败", { timeout: 8_000 })

    const beforeUnload = await page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true }) as BeforeUnloadEvent
      window.dispatchEvent(event)
      return { defaultPrevented: event.defaultPrevented, returnValue: event.returnValue }
    })
    expect(beforeUnload.defaultPrevented).toBe(true)
    expect(beforeUnload.returnValue).toBe(false)
    await expect(editor).toHaveValue("Unsaved navigation guard.")
  })

  test("keeps concurrent text generation busy and error state isolated by node", async ({ page, request }) => {
    const model = {
      value: "e2e/mock-text",
      providerID: "e2e",
      modelID: "mock-text",
      label: "E2E Mock Text",
      providerLabel: "E2E",
      available: true,
      supportsImageInput: false,
    }
    await page.route(/\/api\/cinema\/projects\/[^/]+\/text-models$/, (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: { items: [model], selection: { model: model.value }, effectiveModel: model },
      }),
    }))

    const releaseFailures = new Map<string, (message: string) => void>()
    await page.route(/\/api\/cinema\/projects\/[^/]+\/text-generations$/, async (route) => {
      const body = route.request().postDataJSON() as { nodeID: string }
      const message = await new Promise<string>((resolve) => {
        releaseFailures.set(body.nodeID, resolve)
      })
      releaseFailures.delete(body.nodeID)
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          success: false,
          error: { code: "E2E_PROVIDER_FAILURE", message },
        }),
      })
    })

    await openManagedProject(page, request)
    const storyBrief = await startTextGeneration(page, "story-brief", "Expand the first brief.")
    await expect.poll(() => releaseFailures.has("story-brief")).toBe(true)
    const secondBrief = await startTextGeneration(page, "second-brief", "Expand the second brief.")
    await expect.poll(() => releaseFailures.has("second-brief")).toBe(true)

    await expect(storyBrief.locator(".cinema-node-status-dot.is-generating")).toBeVisible()
    await expect(secondBrief.locator(".cinema-node-status-dot.is-generating")).toBeVisible()

    releaseFailures.get("story-brief")?.("First provider failed")
    await expect(storyBrief.locator(".cinema-node-status-dot.is-failed")).toBeVisible()
    await expect(secondBrief.locator(".cinema-node-status-dot.is-generating")).toBeVisible()

    releaseFailures.get("second-brief")?.("Second provider failed")
    await expect(secondBrief.locator(".cinema-node-status-dot.is-failed")).toBeVisible()

    await storyBrief.click()
    await expect(page.getByRole("alert")).toContainText("First provider failed")
    await secondBrief.click()
    await expect(page.getByRole("alert")).toContainText("Second provider failed")
  })
})
