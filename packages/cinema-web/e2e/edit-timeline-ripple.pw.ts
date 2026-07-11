import { expect, test, type APIRequestContext, type Page } from "@playwright/test"

const externalCinemaURL = process.env.CINEMA_E2E_URL
const managedAgentPort = process.env.CINEMA_E2E_AGENT_PORT || "4187"
const agentBaseURL = `http://127.0.0.1:${managedAgentPort}`

async function openTimelineWithClips(page: Page, request: APIRequestContext, count: number) {
  const fixture = await request.get(`${agentBaseURL}/e2e/project`)
  const envelope = await fixture.json() as { data?: { cinemaURL?: string } }
  expect((await request.post(`${agentBaseURL}/e2e/reset`)).ok()).toBe(true)
  await page.goto(envelope.data!.cinemaURL!)
  await page.getByRole("tab", { name: "Edit" }).click()
  await page.getByRole("button", { name: "New Timeline" }).first().click()
  await page.getByRole("tab", { name: "Generated" }).click()
  await page.getByRole("button", { name: "视频" }).click()
  for (let index = 1; index <= count; index += 1) {
    await page.locator(".cinema-timeline-asset-row").filter({ hasText: `Fixture video ${index}` }).dblclick()
    await expect(page.locator(".cinema-timeline-clip")).toHaveCount(index)
  }
  await expect(page.getByText("Saved", { exact: true })).toBeVisible()
}

test.describe("Cinema Timeline context menu and Ripple Delete", () => {
  test.skip(Boolean(externalCinemaURL), "Timeline command assertions use the isolated managed Agent fixture.")

  test("supports keyboard navigation, viewport clamping, Escape, and Show in Assets", async ({ page, request }) => {
    await openTimelineWithClips(page, request, 2)
    const clip = page.locator(".cinema-timeline-clip").filter({ hasText: "Fixture video 2" }).first()
    await clip.click({ button: "right" })
    const menu = page.getByRole("menu", { name: "Fixture video 2 actions" })
    await expect(menu).toBeVisible()
    const split = menu.getByRole("menuitem", { name: /Split at playhead/ })
    const duplicate = menu.getByRole("menuitem", { name: /Duplicate/ })
    const remove = menu.getByRole("menuitem", { name: /^Delete/ })
    const ripple = menu.getByRole("menuitem", { name: /Ripple Delete/ })
    await expect(split).toBeDisabled()
    await expect(duplicate).toBeFocused()
    await page.keyboard.press("ArrowDown")
    await expect(remove).toBeFocused()
    await page.keyboard.press("ArrowDown")
    await expect(ripple).toBeFocused()
    await page.keyboard.press("Escape")
    await expect(menu).toHaveCount(0)
    await expect(clip).toBeFocused()

    await clip.dispatchEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      button: 2,
      clientX: 1439,
      clientY: 899,
    })
    const clampedMenu = page.getByRole("menu", { name: "Fixture video 2 actions" })
    const menuBox = await clampedMenu.boundingBox()
    expect(menuBox).not.toBeNull()
    expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(1432)
    expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(892)
    await clampedMenu.getByRole("menuitem", { name: "Show in Assets" }).click()
    await expect(page.getByRole("tab", { name: "Generated" })).toHaveAttribute("aria-selected", "true")
    await expect(page.getByRole("textbox", { name: "Search assets" })).toHaveValue("Fixture video 2")
    const revealed = page.locator('.cinema-timeline-asset-row[data-asset-id="fixture-video-2"]')
    await expect(revealed).toHaveAttribute("aria-current", "true")
    await expect(revealed).toBeFocused()
  })

  test("runs Split, Duplicate, and Delete from the Clip menu", async ({ page, request }) => {
    await openTimelineWithClips(page, request, 3)
    const observedTypes: string[] = []
    await page.route(/\/timelines\/[^/]+\/commands$/, async (route) => {
      observedTypes.push((route.request().postDataJSON() as { type: string }).type)
      await route.continue()
    })
    const third = page.locator(".cinema-timeline-clip").filter({ hasText: "Fixture video 3" }).first()
    await third.click({ button: "right" })
    await page.getByRole("menuitem", { name: /Duplicate/ }).click()
    await expect.poll(() => observedTypes.filter((type) => type === "add-clips").length).toBe(1)
    await expect(page.locator(".cinema-timeline-clip")).toHaveCount(4)
    await page.keyboard.press("Control+z")
    await expect(page.locator(".cinema-timeline-clip")).toHaveCount(3)

    await page.locator(".cinema-timeline-ruler").click({ position: { x: 48, y: 10 } })
    const first = page.locator(".cinema-timeline-clip").filter({ hasText: "Fixture video 1" }).first()
    const firstBox = await first.boundingBox()
    await page.mouse.click(firstBox!.x + firstBox!.width - 12, firstBox!.y + firstBox!.height / 2, { button: "right" })
    const split = page.getByRole("menuitem", { name: /Split at playhead/ })
    await expect(split).toBeEnabled()
    await split.click()
    await expect.poll(() => observedTypes.filter((type) => type === "split-clip").length).toBe(1)
    await expect(page.locator(".cinema-timeline-clip")).toHaveCount(4)
    await page.keyboard.press("Control+z")
    await expect(page.locator(".cinema-timeline-clip")).toHaveCount(3)

    const second = page.locator(".cinema-timeline-clip").filter({ hasText: "Fixture video 2" }).first()
    await second.click({ button: "right" })
    await page.getByRole("menuitem", { name: /^Delete/ }).click()
    await expect(page.locator(".cinema-timeline-clip")).toHaveCount(2)
    await page.keyboard.press("Control+z")
    await expect(page.locator(".cinema-timeline-clip")).toHaveCount(3)
  })

  test("ripple deletes selected clips in one command and restores them in one Undo step", async ({ page, request }) => {
    await openTimelineWithClips(page, request, 3)
    const commands: Array<{ type: string; clipIDs?: string[] }> = []
    await page.route(/\/timelines\/[^/]+\/commands$/, async (route) => {
      commands.push(route.request().postDataJSON() as { type: string; clipIDs?: string[] })
      await route.continue()
    })
    const second = page.locator(".cinema-timeline-clip").filter({ hasText: "Fixture video 2" }).first()
    const third = page.locator(".cinema-timeline-clip").filter({ hasText: "Fixture video 3" }).first()
    const beforeThird = await third.boundingBox()
    await second.click({ button: "right" })
    await page.getByRole("menuitem", { name: "Ripple Delete" }).click()
    await expect.poll(() => commands.filter((command) => command.type === "ripple-delete-clips").length).toBe(1)
    expect(commands.find((command) => command.type === "ripple-delete-clips")?.clipIDs).toHaveLength(1)
    await expect(page.locator(".cinema-timeline-clip")).toHaveCount(2)
    const rippledThird = await third.boundingBox()
    expect(beforeThird!.x - rippledThird!.x).toBeGreaterThan(95)
    expect(beforeThird!.x - rippledThird!.x).toBeLessThan(97)

    await page.keyboard.press("Control+z")
    await expect(page.locator(".cinema-timeline-clip")).toHaveCount(3)
    const restoredThird = await third.boundingBox()
    expect(Math.abs(restoredThird!.x - beforeThird!.x)).toBeLessThan(1)
    await page.keyboard.press("Control+Shift+z")
    await expect.poll(() => commands.filter((command) => command.type === "ripple-delete-clips").length).toBe(2)
    await expect(page.locator(".cinema-timeline-clip")).toHaveCount(2)
  })
})
