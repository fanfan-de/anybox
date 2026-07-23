import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

const externalCinemaURL = process.env.CINEMA_E2E_URL
const managedAgentPort = process.env.CINEMA_E2E_AGENT_PORT || "4187"
const agentBaseURL = `http://127.0.0.1:${managedAgentPort}`

test.describe("Cinema Timeline tracks", () => {
  test.skip(Boolean(externalCinemaURL), "Track command assertions use the isolated managed Agent fixture.")

  test("creates, renames, reorders, resizes, collapses, and explicitly deletes tracks", async ({ page, request }) => {
    const fixture = await request.get(`${agentBaseURL}/e2e/project`)
    const envelope = await fixture.json() as { data?: { cinemaURL?: string } }
    expect((await request.post(`${agentBaseURL}/e2e/reset`)).ok()).toBe(true)
    await page.goto(envelope.data!.cinemaURL!)
    await page.getByRole("tab", { name: "Edit" }).click()
    await page.getByRole("button", { name: "New Timeline" }).first().click()

    const commands: Array<Record<string, unknown> & { type: string }> = []
    await page.route(/\/timelines\/[^/]+\/commands$/, async (route) => {
      commands.push(route.request().postDataJSON() as Record<string, unknown> & { type: string })
      await route.continue()
    })

    const tracks = page.locator(".cinema-timeline-track")
    await expect(tracks).toHaveCount(2)

    const initialVideoTrack = tracks.filter({ has: page.locator("strong", { hasText: "V1" }) })
    const playhead = page.locator(".cinema-timeline-playhead")
    const playheadLeftBeforeContextMenu = await playhead.evaluate((element) => element.getAttribute("style"))
    await initialVideoTrack.locator(".cinema-timeline-track-lane").click({
      button: "right",
      position: { x: 240, y: 20 },
    })
    await expect(page.getByRole("menu", { name: "V1 actions" })).toBeVisible()
    await expect(page.getByRole("menuitem", { name: "Rename track" })).toBeFocused()
    await expect(playhead).toHaveAttribute("style", playheadLeftBeforeContextMenu ?? "")
    await page.keyboard.press("Escape")
    await expect(page.getByRole("menu", { name: "V1 actions" })).toBeHidden()

    await page.getByRole("button", { name: "Add track" }).click()
    await expect(page.getByRole("menuitem", { name: "Add video track" })).toBeVisible()
    await expect(page.getByRole("menuitem", { name: "Add audio track" })).toBeVisible()
    await page.getByRole("menuitem", { name: "Add overlay/text track" }).click()
    await expect(tracks).toHaveCount(3)
    await expect.poll(() => commands.filter((command) => command.type === "create-track").length).toBe(1)
    expect(commands.find((command) => command.type === "create-track")).toMatchObject({
      track: { kind: "overlay", title: "O1", order: 2 },
    })

    let overlayTrack = tracks.filter({ has: page.locator("strong", { hasText: "O1" }) })
    await overlayTrack.getByRole("button", { name: "O1 actions" }).click()
    await page.getByRole("menuitem", { name: "Rename track" }).click()
    const renameInput = page.getByRole("textbox", { name: "Rename track" })
    await expect(renameInput).toBeFocused()
    await renameInput.fill("Titles")
    await renameInput.press("Enter")
    overlayTrack = tracks.filter({ has: page.locator("strong", { hasText: "Titles" }) })
    await expect(overlayTrack).toHaveCount(1)
    await expect.poll(() => commands.filter((command) => command.type === "update-track").length).toBe(1)

    await overlayTrack.getByRole("button", { name: "Titles actions" }).click()
    await page.getByRole("menuitem", { name: "Move track up" }).click()
    await expect.poll(() => commands.filter((command) => command.type === "reorder-tracks").length).toBe(1)
    await expect(tracks.nth(0).locator("strong")).toHaveText("V1")
    await expect(tracks.nth(1).locator("strong")).toHaveText("Titles")
    await expect(tracks.nth(2).locator("strong")).toHaveText("A1")

    let audioTrack = tracks.filter({ has: page.locator("strong", { hasText: "A1" }) })
    const resizeAudio = audioTrack.getByRole("separator", { name: "Resize A1" })
    await resizeAudio.focus()
    await resizeAudio.press("End")
    await expect(resizeAudio).toHaveAttribute("aria-valuenow", "240")
    await audioTrack.getByRole("button", { name: "A1 actions" }).click()
    await page.getByRole("menuitem", { name: "Collapse track" }).click()
    await expect(audioTrack).toHaveClass(/is-collapsed/)
    await expect.poll(() => page.evaluate(() => {
      const key = Object.keys(localStorage).find((candidate) => candidate.startsWith("anybox:cinema:timeline-ui:"))
      if (!key) return null
      const snapshot = JSON.parse(localStorage.getItem(key) ?? "null") as {
        trackHeightsPx?: Record<string, number>
        collapsedTrackIDs?: string[]
      } | null
      return snapshot && {
        heights: Object.values(snapshot.trackHeightsPx ?? {}),
        collapsedCount: snapshot.collapsedTrackIDs?.length ?? 0,
      }
    })).toEqual({ heights: [240], collapsedCount: 1 })

    let videoTrack = tracks.filter({ has: page.locator("strong", { hasText: "V1" }) })
    await videoTrack.getByRole("button", { name: "V1 lock" }).click()
    await videoTrack.getByRole("button", { name: "V1 actions" }).click()
    await expect(page.getByRole("menuitem", { name: "Delete track" })).toBeDisabled()
    await page.keyboard.press("Escape")
    await videoTrack.getByRole("button", { name: "V1 lock" }).click()

    await page.getByRole("tab", { name: "Outputs" }).click()
    await page.getByRole("button", { name: "视频" }).click()
    await page.locator(".cinema-timeline-asset-row").filter({ hasText: "Fixture video 1" }).dblclick()
    await expect(page.locator(".cinema-timeline-clip")).toHaveCount(1)
    await expect(page.getByText("Saved", { exact: true })).toBeVisible()

    videoTrack = tracks.filter({ has: page.locator("strong", { hasText: "V1" }) })
    await videoTrack.getByRole("button", { name: "V1 actions" }).click()
    await page.getByRole("menuitem", { name: "Delete track" }).click()
    const dialog = page.getByRole("alertdialog")
    await expect(dialog).toContainText("1 clip(s)")
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused()
    for (const theme of ["dark", "light"] as const) {
      await page.evaluate((value) => { document.documentElement.dataset.theme = value }, theme)
      const accessibility = await new AxeBuilder({ page }).include(".cinema-confirm-dialog").analyze()
      expect(accessibility.violations).toEqual([])
    }
    await page.evaluate(() => { document.documentElement.dataset.theme = "dark" })
    await dialog.getByRole("button", { name: "Delete track and clips" }).click()
    await expect(tracks).toHaveCount(2)
    await expect(page.locator(".cinema-timeline-clip")).toHaveCount(0)
    await expect.poll(() => commands.filter((command) => command.type === "delete-track" && command.deleteClips === true).length).toBe(1)

    const commandCountBeforeUndo = commands.length
    await page.keyboard.press("Control+z")
    await expect(tracks).toHaveCount(3)
    await expect(page.locator(".cinema-timeline-clip")).toHaveCount(1)
    await expect.poll(() => commands.length).toBe(commandCountBeforeUndo + 2)
    expect(commands.slice(-2).map((command) => command.type)).toEqual(["create-track", "add-clips"])
    await expect(page.getByText("Saved", { exact: true })).toBeVisible()

    await page.waitForTimeout(350)
    await page.reload()
    await page.getByRole("tab", { name: "Edit" }).click()
    audioTrack = page.locator(".cinema-timeline-track").filter({ has: page.locator("strong", { hasText: "A1" }) })
    await expect(audioTrack).toHaveClass(/is-collapsed/)
    await audioTrack.getByRole("button", { name: "A1 actions" }).click()
    await page.getByRole("menuitem", { name: "Expand track" }).click()
    await expect(audioTrack.getByRole("separator", { name: "Resize A1" })).toHaveAttribute("aria-valuenow", "240")
  })
})
