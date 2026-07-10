import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

const externalCinemaURL = process.env.CINEMA_E2E_URL
const deliverEnabled = process.env.VITE_CINEMA_DELIVER_DEV === "1"
const managedAgentPort = process.env.CINEMA_E2E_AGENT_PORT || "4187"
const agentBaseURL = `http://127.0.0.1:${managedAgentPort}`

test.describe("Cinema Deliver workbench", () => {
  test.skip(Boolean(externalCinemaURL) || !deliverEnabled, "Deliver P0 runs against the isolated fixture with VITE_CINEMA_DELIVER_DEV=1.")

  test("renders the multi-track fixture and keeps the revision-frozen output after refresh", async ({ page, request }) => {
    test.setTimeout(60_000)
    const fixture = await request.get(`${agentBaseURL}/e2e/project`)
    const envelope = await fixture.json() as { data?: { projectID?: string; cinemaURL?: string } }
    const projectID = envelope.data?.projectID
    const cinemaURL = envelope.data?.cinemaURL
    expect(projectID).toBeTruthy()
    expect(cinemaURL).toBeTruthy()
    expect((await request.post(`${agentBaseURL}/e2e/reset`)).ok()).toBe(true)
    const seedResponse = await request.post(`${agentBaseURL}/e2e/seed-deliver-timeline`)
    expect(seedResponse.ok()).toBe(true)
    expect((await seedResponse.json() as { data?: unknown }).data).toMatchObject({
      timelineID: "deliver-timeline",
      videoClips: 3,
      audioClips: 1,
      imageClips: 1,
    })
    const timelineResponse = await request.get(
      `${agentBaseURL}/api/cinema/projects/${encodeURIComponent(projectID!)}/timelines/deliver-timeline`,
    )
    const seededTimeline = (await timelineResponse.json() as {
      data?: { clips?: Array<{ id: string; trackID: string; timelineStartUs: number; kind: string }> }
    }).data
    const seededVideoClips = (seededTimeline?.clips ?? [])
      .filter((clip) => clip.trackID === "v1" && clip.kind === "video")
      .sort((left, right) => left.timelineStartUs - right.timelineStartUs)
    expect(seededVideoClips.map((clip) => clip.id)).toEqual(["deliver-video-1", "deliver-video-2", "deliver-video-3"])
    expect(seededVideoClips.map((clip) => clip.timelineStartUs)).toEqual([0, 500_000, 1_000_000])
    expect(seededTimeline?.clips?.filter((clip) => clip.trackID === "a1")).toHaveLength(1)
    expect(seededTimeline?.clips?.filter((clip) => clip.kind === "image")).toHaveLength(1)

    await page.goto(cinemaURL!)
    const deliverTab = page.getByRole("tab", { name: /^Deliver/ })
    await expect(deliverTab).toBeEnabled()
    await deliverTab.click()
    await expect(page.getByRole("heading", { name: "Delivery fixture" })).toBeVisible()
    await expect(page.getByText("Ready", { exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole("button", { name: /Start render/ })).toBeEnabled()
    await expect(page.getByLabel("Timeline delivery summary")).toContainText("Video 3")
    await expect(page.getByLabel("Timeline delivery summary")).toContainText("Audio 1")

    for (const theme of ["dark", "light"] as const) {
      await page.evaluate((value) => { document.documentElement.dataset.theme = value }, theme)
      const accessibility = await new AxeBuilder({ page }).include(".cinema-deliver-workbench").analyze()
      expect(accessibility.violations).toEqual([])
    }
    await page.keyboard.press("Escape")
    await expect(page.getByRole("complementary", { name: "Render settings" })).toBeHidden()
    await page.getByRole("button", { name: "Toggle render settings" }).click()
    await page.keyboard.press("Control+Enter")
    await expect(page.getByRole("status").filter({ hasText: /Queued|Preparing|Checking|Rendering|Completed/ }).first()).toBeVisible()
    await expect(page.getByText("Output verified and registered in Assets.")).toBeVisible({ timeout: 30_000 })
    const outputPreview = page.locator("video[aria-label$='output preview']")
    await expect(outputPreview).toBeVisible()
    await expect.poll(async () => outputPreview.evaluate((video) => (
      video.readyState >= HTMLMediaElement.HAVE_METADATA
      && Number.isFinite(video.duration)
      && video.duration > 0
      && video.error === null
    )), { timeout: 15_000 }).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

    for (const width of [1280, 900, 760]) {
      await page.setViewportSize({ width, height: 760 })
      await expect(page.getByRole("heading", { name: "Delivery fixture" })).toBeVisible()
      await expect(page.getByText("Deliver needs a wider desktop window")).toBeHidden()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    }
    await page.setViewportSize({ width: 759, height: 760 })
    await expect(page.getByText("Deliver needs a wider desktop window")).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

    const jobsResponse = await request.get(
      `${agentBaseURL}/api/cinema/projects/${encodeURIComponent(projectID!)}/timelines/deliver-timeline/render-jobs`,
    )
    const renderedJobs = (await jobsResponse.json() as {
      data?: { items?: Array<{ id: string; status: string; timelineRevision: number; outputAssetRef?: unknown }> }
    }).data?.items ?? []
    const renderedJob = renderedJobs.find((job) => job.status === "succeeded")
    expect(renderedJob).toMatchObject({ status: "succeeded", timelineRevision: 0 })
    expect(renderedJob).toHaveProperty("outputAssetRef")
    const eventsResponse = await request.get(
      `${agentBaseURL}/api/cinema/projects/${encodeURIComponent(projectID!)}/render-jobs/${encodeURIComponent(renderedJob!.id)}/events`,
    )
    const eventTypes = ((await eventsResponse.json() as {
      data?: { items?: Array<{ type?: string }> }
    }).data?.items ?? []).map((event) => event.type)
    expect(eventTypes).toEqual(expect.arrayContaining([
      "snapshot-started",
      "snapshot-completed",
      "probe-completed",
      "render-started",
      "render-progress",
      "registration-started",
      "render-succeeded",
    ]))

    const commandResponse = await request.post(
      `${agentBaseURL}/api/cinema/projects/${encodeURIComponent(projectID!)}/timelines/deliver-timeline/commands`,
      {
        data: {
          id: "e2e-post-render-revision",
          timelineID: "deliver-timeline",
          baseRevision: 0,
          actor: "deliver-e2e",
          type: "update-clip",
          clipID: "deliver-video-1",
          patch: { title: "Revision 1 video" },
        },
      },
    )
    expect(commandResponse.ok()).toBe(true)
    expect((await commandResponse.json() as { data?: { timeline?: { revision?: number } } }).data?.timeline?.revision).toBe(1)

    await page.setViewportSize({ width: 1280, height: 760 })
    await page.reload()
    await page.getByRole("tab", { name: /^Deliver/ }).click()
    await expect(page.getByRole("heading", { name: "Delivery fixture" })).toBeVisible()
    await expect(page.locator("video[aria-label$='output preview']")).toBeVisible()
    await expect(page.getByRole("listbox", { name: "Render history jobs" }).getByRole("option")).toHaveCount(1)
    await expect(page.getByRole("listbox", { name: "Render history jobs" }).getByRole("option")).toContainText("rev 0")
    await expect(page.getByRole("listbox", { name: "Choose a Timeline" }).getByRole("option", { selected: true })).toContainText("Rev 1")
  })

  test("blocks an empty Timeline with actionable preflight issues and no create action", async ({ page, request }) => {
    const fixture = await request.get(`${agentBaseURL}/e2e/project`)
    const envelope = await fixture.json() as { data?: { projectID?: string; cinemaURL?: string } }
    const projectID = envelope.data?.projectID
    const cinemaURL = envelope.data?.cinemaURL
    expect(projectID).toBeTruthy()
    expect(cinemaURL).toBeTruthy()
    expect((await request.post(`${agentBaseURL}/e2e/reset`)).ok()).toBe(true)
    expect((await request.post(`${agentBaseURL}/e2e/seed-blocked-timeline`)).ok()).toBe(true)

    await page.goto(cinemaURL!)
    await page.getByRole("tab", { name: /^Deliver/ }).click()
    await expect(page.getByRole("heading", { name: "Blocked empty fixture" })).toBeVisible()
    const issues = page.getByRole("region", { name: "Preflight issues" })
    await expect(issues).toContainText("Resolve before rendering")
    await expect(issues).toContainText("The Timeline does not contain any Clips.")
    await expect(issues).toContainText("The output range has no visible main video.")
    await expect(page.getByRole("button", { name: "Start render" })).toBeDisabled()
    await page.keyboard.press("Control+Enter")
    await expect(page.getByText("No renders for this Timeline yet.")).toBeVisible()

    const preflightResponse = await request.get(
      `${agentBaseURL}/api/cinema/projects/${encodeURIComponent(projectID!)}/timelines/blocked-timeline/delivery-preflight`,
    )
    expect(preflightResponse.ok()).toBe(true)
    const preflight = (await preflightResponse.json() as {
      data?: { ready?: boolean; issues?: Array<{ code?: string; severity?: string }> }
    }).data
    expect(preflight?.ready).toBe(false)
    expect(preflight?.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "timeline-empty", severity: "error" }),
      expect.objectContaining({ code: "main-video-missing", severity: "error" }),
    ]))
  })

  test("blocks rendering when the project working space is exhausted", async ({ page, request }) => {
    const fixture = await request.get(`${agentBaseURL}/e2e/project`)
    const envelope = await fixture.json() as { data?: { projectID?: string; cinemaURL?: string } }
    const projectID = envelope.data?.projectID
    const cinemaURL = envelope.data?.cinemaURL
    expect(projectID).toBeTruthy()
    expect(cinemaURL).toBeTruthy()
    expect((await request.post(`${agentBaseURL}/e2e/reset`)).ok()).toBe(true)
    expect((await request.post(`${agentBaseURL}/e2e/seed-deliver-timeline`)).ok()).toBe(true)
    expect((await request.post(`${agentBaseURL}/e2e/faults/working-space-insufficient`)).ok()).toBe(true)

    try {
      await page.goto(cinemaURL!)
      await page.getByRole("tab", { name: /^Deliver/ }).click()
      await expect(page.getByRole("heading", { name: "Delivery fixture" })).toBeVisible()
      const issues = page.getByRole("region", { name: "Preflight issues" })
      await expect(issues).toContainText("The Cinema project does not have enough free space for this render.")
      await expect(page.getByRole("button", { name: "Start render" })).toBeDisabled()

      const preflightResponse = await request.get(
        `${agentBaseURL}/api/cinema/projects/${encodeURIComponent(projectID!)}/timelines/deliver-timeline/delivery-preflight`,
      )
      const preflight = (await preflightResponse.json() as {
        data?: { ready?: boolean; issues?: Array<{ code?: string; severity?: string }> }
      }).data
      expect(preflight?.ready).toBe(false)
      expect(preflight?.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "working-space-insufficient", severity: "error" }),
      ]))
    } finally {
      expect((await request.post(`${agentBaseURL}/e2e/faults/restore`)).ok()).toBe(true)
    }
  })

  test("fails an EACCES input snapshot without registering a fake output asset", async ({ page, request }) => {
    const fixture = await request.get(`${agentBaseURL}/e2e/project`)
    const envelope = await fixture.json() as { data?: { projectID?: string; cinemaURL?: string } }
    const projectID = envelope.data?.projectID
    const cinemaURL = envelope.data?.cinemaURL
    expect(projectID).toBeTruthy()
    expect(cinemaURL).toBeTruthy()
    expect((await request.post(`${agentBaseURL}/e2e/reset`)).ok()).toBe(true)
    expect((await request.post(`${agentBaseURL}/e2e/seed-deliver-timeline`)).ok()).toBe(true)
    const stateURL = `${agentBaseURL}/api/cinema/projects/${encodeURIComponent(projectID!)}/library/state`
    const initialAssetCount = (await (await request.get(stateURL)).json() as {
      data?: { counts?: { assets?: number } }
    }).data?.counts?.assets
    expect((await request.post(`${agentBaseURL}/e2e/faults/snapshot-permission-denied`)).ok()).toBe(true)

    try {
      await page.goto(cinemaURL!)
      await page.getByRole("tab", { name: /^Deliver/ }).click()
      const startButton = page.getByRole("button", { name: "Start render" })
      await expect(startButton).toBeEnabled({ timeout: 15_000 })
      await startButton.click()
      await expect(page.getByRole("alert").filter({ hasText: "Render inputs could not be snapshotted." })).toBeVisible({ timeout: 15_000 })
      await expect(page.locator("video[aria-label$='output preview']")).toHaveCount(0)

      const jobsResponse = await request.get(
        `${agentBaseURL}/api/cinema/projects/${encodeURIComponent(projectID!)}/timelines/deliver-timeline/render-jobs`,
      )
      const jobs = (await jobsResponse.json() as {
        data?: { items?: Array<{ id: string; status: string; outputAssetRef?: unknown; error?: { code?: string; retryable?: boolean } }> }
      }).data?.items ?? []
      expect(jobs).toHaveLength(1)
      expect(jobs[0]).toMatchObject({
        status: "failed",
        error: { code: "snapshot-failed", retryable: true },
      })
      expect(jobs[0]).not.toHaveProperty("outputAssetRef")

      const eventsResponse = await request.get(
        `${agentBaseURL}/api/cinema/projects/${encodeURIComponent(projectID!)}/render-jobs/${encodeURIComponent(jobs[0]!.id)}/events`,
      )
      const eventTypes = ((await eventsResponse.json() as {
        data?: { items?: Array<{ type?: string }> }
      }).data?.items ?? []).map((event) => event.type)
      expect(eventTypes).toContain("snapshot-started")
      expect(eventTypes).toContain("render-failed")
      expect(eventTypes).not.toContain("registration-started")
      const finalAssetCount = (await (await request.get(stateURL)).json() as {
        data?: { counts?: { assets?: number } }
      }).data?.counts?.assets
      expect(finalAssetCount).toBe(initialAssetCount)
    } finally {
      expect((await request.post(`${agentBaseURL}/e2e/faults/restore`)).ok()).toBe(true)
    }
  })

  test("rolls back output registration failure without exposing a fake Asset", async ({ page, request }) => {
    test.setTimeout(60_000)
    const fixture = await request.get(`${agentBaseURL}/e2e/project`)
    const envelope = await fixture.json() as { data?: { projectID?: string; cinemaURL?: string } }
    const projectID = envelope.data?.projectID
    const cinemaURL = envelope.data?.cinemaURL
    expect(projectID).toBeTruthy()
    expect(cinemaURL).toBeTruthy()
    expect((await request.post(`${agentBaseURL}/e2e/reset`)).ok()).toBe(true)
    expect((await request.post(`${agentBaseURL}/e2e/seed-deliver-timeline`)).ok()).toBe(true)
    const stateURL = `${agentBaseURL}/api/cinema/projects/${encodeURIComponent(projectID!)}/library/state`
    const initialState = (await (await request.get(stateURL)).json() as {
      data?: { counts?: { assets?: number }; defaultFolderIDs?: { exports?: string } }
    }).data
    expect(initialState?.defaultFolderIDs?.exports).toBeTruthy()
    expect((await request.post(`${agentBaseURL}/e2e/faults/output-registration-failure`)).ok()).toBe(true)

    try {
      await page.goto(cinemaURL!)
      await page.getByRole("tab", { name: /^Deliver/ }).click()
      const startButton = page.getByRole("button", { name: "Start render" })
      await expect(startButton).toBeEnabled({ timeout: 15_000 })
      await startButton.click()
      await expect(page.getByRole("alert").filter({ hasText: "Rendered output could not be registered." })).toBeVisible({ timeout: 30_000 })
      await expect(page.locator("video[aria-label$='output preview']")).toHaveCount(0)

      const jobsResponse = await request.get(
        `${agentBaseURL}/api/cinema/projects/${encodeURIComponent(projectID!)}/timelines/deliver-timeline/render-jobs`,
      )
      const jobs = (await jobsResponse.json() as {
        data?: { items?: Array<{ id: string; status: string; outputAssetRef?: unknown; error?: { code?: string } }> }
      }).data?.items ?? []
      expect(jobs).toHaveLength(1)
      expect(jobs[0]).toMatchObject({ status: "failed", error: { code: "output-registration-failed" } })
      expect(jobs[0]).not.toHaveProperty("outputAssetRef")

      const finalState = (await (await request.get(stateURL)).json() as {
        data?: { counts?: { assets?: number } }
      }).data
      expect(finalState?.counts?.assets).toBe(initialState?.counts?.assets)
      const exportEntriesResponse = await request.get(
        `${agentBaseURL}/api/cinema/projects/${encodeURIComponent(projectID!)}/library/entries?folderID=${encodeURIComponent(initialState!.defaultFolderIDs!.exports!)}`,
      )
      const exportEntries = (await exportEntriesResponse.json() as {
        data?: { entries?: Array<{ entryType?: string; asset?: { source?: string } }> }
      }).data?.entries ?? []
      expect(exportEntries.filter((entry) => entry.entryType === "asset" && entry.asset?.source === "render")).toEqual([])
    } finally {
      expect((await request.post(`${agentBaseURL}/e2e/faults/restore`)).ok()).toBe(true)
    }
  })

  test("cancels a real active rendering job and leaves no output", async ({ page, request }) => {
    test.setTimeout(60_000)
    const fixture = await request.get(`${agentBaseURL}/e2e/project`)
    const envelope = await fixture.json() as { data?: { projectID?: string; cinemaURL?: string } }
    const projectID = envelope.data?.projectID
    const cinemaURL = envelope.data?.cinemaURL
    expect(projectID).toBeTruthy()
    expect(cinemaURL).toBeTruthy()
    expect((await request.post(`${agentBaseURL}/e2e/reset`)).ok()).toBe(true)
    expect((await request.post(`${agentBaseURL}/e2e/seed-deliver-timeline`)).ok()).toBe(true)
    expect((await request.post(`${agentBaseURL}/e2e/faults/hold-running-render`)).ok()).toBe(true)
    const jobsURL = `${agentBaseURL}/api/cinema/projects/${encodeURIComponent(projectID!)}/timelines/deliver-timeline/render-jobs`
    let runningJobID: string | undefined

    try {
      await page.goto(cinemaURL!)
      await page.getByRole("tab", { name: /^Deliver/ }).click()
      const startButton = page.getByRole("button", { name: "Start render" })
      await expect(startButton).toBeEnabled({ timeout: 15_000 })
      await startButton.click()
      await expect.poll(async () => {
        const jobs = (await (await request.get(jobsURL)).json() as {
          data?: { items?: Array<{ id: string; status: string }> }
        }).data?.items ?? []
        const running = jobs.find((job) => job.status === "rendering")
        runningJobID = running?.id
        return running?.status
      }, { timeout: 15_000 }).toBe("rendering")
      await expect(page.getByRole("status").filter({ hasText: "Rendering with FFmpeg" })).toBeVisible()
      const cancelButton = page.getByRole("button", { name: "Cancel", exact: true })
      await expect(cancelButton).toBeVisible()
      await cancelButton.click()
      await expect(page.getByText("This render was canceled.")).toBeVisible({ timeout: 15_000 })
      await expect(page.locator("video[aria-label$='output preview']")).toHaveCount(0)

      const jobResponse = await request.get(
        `${agentBaseURL}/api/cinema/projects/${encodeURIComponent(projectID!)}/render-jobs/${encodeURIComponent(runningJobID!)}`,
      )
      const canceled = (await jobResponse.json() as {
        data?: { status?: string; outputAssetRef?: unknown }
      }).data
      expect(canceled?.status).toBe("canceled")
      expect(canceled).not.toHaveProperty("outputAssetRef")
      const eventsResponse = await request.get(
        `${agentBaseURL}/api/cinema/projects/${encodeURIComponent(projectID!)}/render-jobs/${encodeURIComponent(runningJobID!)}/events`,
      )
      const eventTypes = ((await eventsResponse.json() as {
        data?: { items?: Array<{ type?: string }> }
      }).data?.items ?? []).map((event) => event.type)
      expect(eventTypes).toContain("render-started")
      expect(eventTypes).toContain("render-canceled")
      expect(eventTypes).not.toContain("registration-started")
    } finally {
      expect((await request.post(`${agentBaseURL}/e2e/faults/restore`)).ok()).toBe(true)
    }
  })

  test("returns the same persisted job for a repeated operationID", async ({ request }) => {
    test.setTimeout(60_000)
    const fixture = await request.get(`${agentBaseURL}/e2e/project`)
    const envelope = await fixture.json() as { data?: { projectID?: string } }
    const projectID = envelope.data?.projectID
    expect(projectID).toBeTruthy()
    expect((await request.post(`${agentBaseURL}/e2e/reset`)).ok()).toBe(true)
    expect((await request.post(`${agentBaseURL}/e2e/seed-deliver-timeline`)).ok()).toBe(true)
    const createURL = `${agentBaseURL}/api/cinema/projects/${encodeURIComponent(projectID!)}/timelines/deliver-timeline/render-jobs`
    const createBody = {
      operationID: "e2e-idempotent-render",
      expectedTimelineRevision: 0,
      settings: {
        format: "mp4",
        videoCodec: "h264",
        audioCodec: "aac",
        width: 320,
        height: 180,
        frameRate: { numerator: 25, denominator: 1 },
        quality: { mode: "balanced" },
        audioBitrateKbps: 192,
        range: { type: "full" },
        outputName: "Idempotent render",
      },
    }
    const firstResponse = await request.post(createURL, { data: createBody })
    const secondResponse = await request.post(createURL, { data: createBody })
    expect(firstResponse.status()).toBe(202)
    expect(secondResponse.status()).toBe(202)
    const first = (await firstResponse.json() as { data?: { id?: string; operationID?: string } }).data
    const second = (await secondResponse.json() as { data?: { id?: string; operationID?: string } }).data
    expect(first?.id).toBeTruthy()
    expect(second).toMatchObject({ id: first?.id, operationID: "e2e-idempotent-render" })

    const jobsResponse = await request.get(createURL)
    const jobs = (await jobsResponse.json() as {
      data?: { items?: Array<{ id: string; operationID: string }> }
    }).data?.items ?? []
    expect(jobs).toEqual([expect.objectContaining({ id: first?.id, operationID: "e2e-idempotent-render" })])

    await expect.poll(async () => {
      const response = await request.get(
        `${agentBaseURL}/api/cinema/projects/${encodeURIComponent(projectID!)}/render-jobs/${encodeURIComponent(first!.id!)}`,
      )
      return (await response.json() as { data?: { status?: string } }).data?.status
    }, { timeout: 30_000 }).toBe("succeeded")
  })

  test("supports the Timeline, settings, preset, and create path from the keyboard", async ({ page, request }) => {
    test.setTimeout(60_000)
    const fixture = await request.get(`${agentBaseURL}/e2e/project`)
    const envelope = await fixture.json() as { data?: { cinemaURL?: string } }
    const cinemaURL = envelope.data?.cinemaURL
    expect(cinemaURL).toBeTruthy()
    expect((await request.post(`${agentBaseURL}/e2e/reset`)).ok()).toBe(true)
    expect((await request.post(`${agentBaseURL}/e2e/seed-deliver-timeline`)).ok()).toBe(true)
    expect((await request.post(`${agentBaseURL}/e2e/seed-blocked-timeline`)).ok()).toBe(true)

    await page.goto(cinemaURL!)
    await page.getByRole("tab", { name: /^Deliver/ }).click()
    const timelineOptions = page.getByRole("listbox", { name: "Choose a Timeline" }).getByRole("option")
    await expect(timelineOptions).toHaveCount(2)
    await expect(timelineOptions.nth(0)).toContainText("Blocked empty fixture")
    await timelineOptions.nth(0).focus()
    await page.keyboard.press("ArrowDown")
    await expect(timelineOptions.nth(1)).toHaveAttribute("aria-selected", "true")
    await expect(page.getByRole("heading", { name: "Delivery fixture" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Start render" })).toBeEnabled({ timeout: 15_000 })

    const settingsToggle = page.getByRole("button", { name: "Toggle render settings" })
    await settingsToggle.focus()
    await page.keyboard.press("Enter")
    await expect(settingsToggle).toHaveAttribute("aria-expanded", "false")
    await expect(page.getByRole("complementary", { name: "Render settings" })).toBeHidden()
    await page.keyboard.press("Enter")
    await expect(settingsToggle).toHaveAttribute("aria-expanded", "true")

    const qualityPreset = page.getByRole("listbox", { name: "Render preset" }).getByRole("option", { name: "Quality" })
    await qualityPreset.focus()
    await page.keyboard.press("Enter")
    await expect(qualityPreset).toHaveAttribute("aria-selected", "true")
    const outputName = page.getByRole("textbox", { name: "Output name" })
    await outputName.focus()
    await page.keyboard.press("Control+A")
    await page.keyboard.type("Keyboard render")
    await expect(outputName).toHaveValue("Keyboard render")
    const startButton = page.getByRole("button", { name: "Start render" })
    await expect(startButton).toBeEnabled({ timeout: 15_000 })
    await startButton.focus()
    await page.keyboard.press("Control+Enter")
    await expect(page.getByText("Output verified and registered in Assets.")).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole("listbox", { name: "Render history jobs" }).getByRole("option")).toContainText("Keyboard render.mp4")
  })

  test("flushes an Edit command and hands the selected Timeline to Deliver", async ({ page, request }) => {
    const fixture = await request.get(`${agentBaseURL}/e2e/project`)
    const envelope = await fixture.json() as { data?: { projectID?: string; cinemaURL?: string } }
    const projectID = envelope.data?.projectID
    const cinemaURL = envelope.data?.cinemaURL
    expect(projectID).toBeTruthy()
    expect(cinemaURL).toBeTruthy()
    expect((await request.post(`${agentBaseURL}/e2e/reset`)).ok()).toBe(true)
    expect((await request.post(`${agentBaseURL}/e2e/seed-deliver-timeline`)).ok()).toBe(true)
    expect((await request.post(`${agentBaseURL}/e2e/seed-blocked-timeline`)).ok()).toBe(true)

    await page.goto(cinemaURL!)
    await page.getByRole("tab", { name: /^Edit/ }).click()
    const deliveryTimelineRow = page.locator(".cinema-timeline-list-row").filter({ hasText: "Delivery fixture" })
    await expect(deliveryTimelineRow).toBeVisible()
    await deliveryTimelineRow.click()
    const firstVideoClip = page.locator('[data-clip-id="deliver-video-1"]')
    await expect(firstVideoClip).toBeVisible()
    await firstVideoClip.click()
    const inspector = page.getByRole("complementary", { name: "Timeline inspector" })
    await expect(inspector).toBeVisible()
    const clipName = inspector.getByRole("textbox", { name: "Name" })
    await clipName.fill("Handoff saved clip")
    await inspector.getByRole("button", { name: "Apply" }).click()

    await page.getByRole("tab", { name: /^Deliver/ }).click()
    await expect(page.getByRole("heading", { name: "Delivery fixture" })).toBeVisible()
    await expect(page.getByRole("listbox", { name: "Choose a Timeline" }).getByRole("option", { name: /Delivery fixture/ })).toHaveAttribute("aria-selected", "true")

    const timelineResponse = await request.get(
      `${agentBaseURL}/api/cinema/projects/${encodeURIComponent(projectID!)}/timelines/deliver-timeline`,
    )
    const savedTimeline = (await timelineResponse.json() as {
      data?: { revision?: number; clips?: Array<{ id: string; title: string }> }
    }).data
    expect(savedTimeline?.revision).toBe(1)
    expect(savedTimeline?.clips?.find((clip) => clip.id === "deliver-video-1")?.title).toBe("Handoff saved clip")
  })

  test("surfaces a real FFmpeg failure and retries from the unchanged original snapshot", async ({ page, request }) => {
    test.setTimeout(60_000)
    const fixture = await request.get(`${agentBaseURL}/e2e/project`)
    const envelope = await fixture.json() as { data?: { projectID?: string; cinemaURL?: string } }
    const projectID = envelope.data?.projectID
    const cinemaURL = envelope.data?.cinemaURL
    expect(projectID).toBeTruthy()
    expect(cinemaURL).toBeTruthy()
    expect((await request.post(`${agentBaseURL}/e2e/reset`)).ok()).toBe(true)
    expect((await request.post(`${agentBaseURL}/e2e/seed-deliver-timeline`)).ok()).toBe(true)
    const injectedResponse = await request.post(`${agentBaseURL}/e2e/inject-render-failure`)
    expect(injectedResponse.ok()).toBe(true)
    const injected = (await injectedResponse.json() as {
      data?: { job?: { id: string; status: string; error?: { code?: string; retryable?: boolean } } }
    }).data?.job
    expect(injected).toMatchObject({
      status: "failed",
      error: { code: "render-failed", retryable: true },
    })

    await page.goto(cinemaURL!)
    await page.getByRole("tab", { name: /^Deliver/ }).click()
    await expect(page.getByRole("heading", { name: "Delivery fixture" })).toBeVisible()
    await expect(page.getByRole("alert").filter({ hasText: /FFmpeg exited with code/ })).toBeVisible()
    await expect(page.locator("video[aria-label$='output preview']")).toHaveCount(0)
    await page.getByRole("button", { name: "Retry", exact: true }).click()
    await expect(page.getByText("Output verified and registered in Assets.")).toBeVisible({ timeout: 30_000 })

    const jobsResponse = await request.get(
      `${agentBaseURL}/api/cinema/projects/${encodeURIComponent(projectID!)}/timelines/deliver-timeline/render-jobs`,
    )
    expect(jobsResponse.ok()).toBe(true)
    const jobs = (await jobsResponse.json() as {
      data?: { items?: Array<{ id: string; status: string; retryOfJobID?: string; outputAssetRef?: unknown; error?: { code?: string } }> }
    }).data?.items ?? []
    expect(jobs).toHaveLength(2)
    expect(jobs.find((job) => job.id === injected?.id)).toMatchObject({
      status: "failed",
      error: { code: "render-failed" },
    })
    expect(jobs.find((job) => job.retryOfJobID === injected?.id)).toMatchObject({
      status: "succeeded",
      retryOfJobID: injected?.id,
    })
  })

  test("cancels a persisted queued job through the Deliver UI without creating output", async ({ page, request }) => {
    const fixture = await request.get(`${agentBaseURL}/e2e/project`)
    const envelope = await fixture.json() as { data?: { projectID?: string; cinemaURL?: string } }
    const projectID = envelope.data?.projectID
    const cinemaURL = envelope.data?.cinemaURL
    expect(projectID).toBeTruthy()
    expect(cinemaURL).toBeTruthy()
    expect((await request.post(`${agentBaseURL}/e2e/reset`)).ok()).toBe(true)
    expect((await request.post(`${agentBaseURL}/e2e/seed-deliver-timeline`)).ok()).toBe(true)
    const injectedResponse = await request.post(`${agentBaseURL}/e2e/inject-queued-render`)
    expect(injectedResponse.ok()).toBe(true)
    const injected = (await injectedResponse.json() as { data?: { job?: { id: string; status: string } } }).data?.job
    expect(injected?.status).toBe("queued")

    await page.goto(cinemaURL!)
    await page.getByRole("tab", { name: /^Deliver/ }).click()
    await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Cancel", exact: true }).click()
    await expect(page.getByText("This render was canceled.")).toBeVisible()
    await expect(page.locator("video[aria-label$='output preview']")).toHaveCount(0)

    const jobResponse = await request.get(
      `${agentBaseURL}/api/cinema/projects/${encodeURIComponent(projectID!)}/render-jobs/${encodeURIComponent(injected!.id)}`,
    )
    expect(jobResponse.ok()).toBe(true)
    const canceled = (await jobResponse.json() as { data?: { status?: string; outputAssetRef?: unknown } }).data
    expect(canceled?.status).toBe("canceled")
    expect(canceled).not.toHaveProperty("outputAssetRef")
  })

  test("shows restart recovery as interrupted and proves partial output cleanup", async ({ page, request }) => {
    test.setTimeout(60_000)
    const fixture = await request.get(`${agentBaseURL}/e2e/project`)
    const envelope = await fixture.json() as { data?: { projectID?: string; cinemaURL?: string } }
    const projectID = envelope.data?.projectID
    const cinemaURL = envelope.data?.cinemaURL
    expect(projectID).toBeTruthy()
    expect(cinemaURL).toBeTruthy()
    expect((await request.post(`${agentBaseURL}/e2e/reset`)).ok()).toBe(true)
    expect((await request.post(`${agentBaseURL}/e2e/seed-deliver-timeline`)).ok()).toBe(true)
    const injectedResponse = await request.post(`${agentBaseURL}/e2e/inject-agent-interruption`)
    expect(injectedResponse.ok()).toBe(true)
    const injected = (await injectedResponse.json() as {
      data?: {
        job?: { id: string; status: string }
        recovery?: { interruptedJobIDs?: string[] }
        partialOutputExists?: boolean
      }
    }).data
    expect(injected?.job?.status).toBe("interrupted")
    expect(injected?.recovery?.interruptedJobIDs).toContain(injected?.job?.id)
    expect(injected?.partialOutputExists).toBe(false)

    const eventsResponse = await request.get(
      `${agentBaseURL}/api/cinema/projects/${encodeURIComponent(projectID!)}/render-jobs/${encodeURIComponent(injected!.job!.id)}/events`,
    )
    const events = (await eventsResponse.json() as { data?: { items?: Array<{ type?: string }> } }).data?.items ?? []
    expect(events.some((event) => event.type === "render-interrupted")).toBe(true)

    await page.goto(cinemaURL!)
    await page.getByRole("tab", { name: /^Deliver/ }).click()
    await expect(page.getByText("The Agent stopped while this render job was running.")).toBeVisible()
    await expect(page.getByRole("button", { name: "Start a new render", exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Retry", exact: true }).click()
    await expect(page.getByText("Output verified and registered in Assets.")).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole("button", { name: "Render again", exact: true })).toBeVisible()
    await expect(page.locator("video[aria-label$='output preview']")).toBeVisible()

    const jobsResponse = await request.get(
      `${agentBaseURL}/api/cinema/projects/${encodeURIComponent(projectID!)}/timelines/deliver-timeline/render-jobs`,
    )
    const jobs = (await jobsResponse.json() as {
      data?: { items?: Array<{ id: string; status: string; retryOfJobID?: string; outputAssetRef?: unknown }> }
    }).data?.items ?? []
    expect(jobs.find((job) => job.id === injected?.job?.id)).toMatchObject({ status: "interrupted" })
    expect(jobs.find((job) => job.retryOfJobID === injected?.job?.id)).toMatchObject({
      status: "succeeded",
      retryOfJobID: injected?.job?.id,
    })
  })

  test("keeps a 500-clip preflight bounded and reports structured support counts", async ({ request }) => {
    const fixture = await request.get(`${agentBaseURL}/e2e/project`)
    const envelope = await fixture.json() as { data?: { projectID?: string } }
    const projectID = envelope.data?.projectID
    expect(projectID).toBeTruthy()
    expect((await request.post(`${agentBaseURL}/e2e/reset`)).ok()).toBe(true)
    expect((await request.post(`${agentBaseURL}/e2e/seed-large-timeline`)).ok()).toBe(true)
    const timelineResponse = await request.get(`${agentBaseURL}/api/cinema/projects/${encodeURIComponent(projectID!)}/timelines`)
    const timelines = (await timelineResponse.json() as { data?: { timelines?: Array<{ id: string; revision: number; settings: { width: number; height: number; frameRate: { numerator: number; denominator: number } } }> } }).data?.timelines ?? []
    const timeline = timelines.find((candidate) => candidate.id === "large-timeline")
    expect(timeline).toBeTruthy()
    const settings = {
      format: "mp4",
      videoCodec: "h264",
      audioCodec: "aac",
      width: 1920,
      height: 1080,
      frameRate: { numerator: 25, denominator: 1 },
      quality: { mode: "balanced" },
      audioBitrateKbps: 192,
      range: { type: "full" },
      outputName: "500 clip preflight",
    }
    const startedAt = Date.now()
    const preflightResponse = await request.get(
      `${agentBaseURL}/api/cinema/projects/${encodeURIComponent(projectID!)}/timelines/large-timeline/delivery-preflight?settings=${encodeURIComponent(JSON.stringify(settings))}`,
    )
    const elapsedMs = Date.now() - startedAt
    expect(preflightResponse.ok()).toBe(true)
    const result = (await preflightResponse.json() as { data?: { ready?: boolean; support?: { imageClips?: number } } }).data
    expect(result?.ready).toBe(false)
    expect(result?.support?.imageClips).toBe(500)
    expect(elapsedMs).toBeLessThan(1_000)
  })

  test("loads 1000 persisted jobs within the first-screen budget and virtualizes history rows", async ({ page, request }) => {
    test.setTimeout(90_000)
    const fixture = await request.get(`${agentBaseURL}/e2e/project`)
    const envelope = await fixture.json() as { data?: { projectID?: string; cinemaURL?: string } }
    const projectID = envelope.data?.projectID
    const cinemaURL = envelope.data?.cinemaURL
    expect(projectID).toBeTruthy()
    expect(cinemaURL).toBeTruthy()
    expect((await request.post(`${agentBaseURL}/e2e/reset`)).ok()).toBe(true)
    expect((await request.post(`${agentBaseURL}/e2e/seed-deliver-timeline`)).ok()).toBe(true)
    const seedResponse = await request.post(`${agentBaseURL}/e2e/seed-render-history`, { timeout: 60_000 })
    expect(seedResponse.ok()).toBe(true)
    const seeded = (await seedResponse.json() as { data?: { count?: number; seedElapsedMs?: number } }).data
    expect(seeded?.count).toBe(1_000)

    const apiStartedAt = performance.now()
    const jobsResponse = await request.get(
      `${agentBaseURL}/api/cinema/projects/${encodeURIComponent(projectID!)}/timelines/deliver-timeline/render-jobs`,
    )
    expect(jobsResponse.ok()).toBe(true)
    const jobs = (await jobsResponse.json() as { data?: { items?: unknown[] } }).data?.items ?? []
    const apiElapsedMs = performance.now() - apiStartedAt
    expect(jobs).toHaveLength(1_000)
    expect(apiElapsedMs).toBeLessThan(1_000)

    await page.goto(cinemaURL!)
    const deliverTab = page.getByRole("tab", { name: /^Deliver/ })
    await expect(deliverTab).toBeEnabled()
    const uiJobsResponsePromise = page.waitForResponse((response) => (
      response.request().method() === "GET"
      && response.url().includes("/timelines/deliver-timeline/render-jobs")
    ))
    const uiStartedAt = performance.now()
    await deliverTab.click()
    const uiJobsResponse = await uiJobsResponsePromise
    await uiJobsResponse.finished()
    const uiJobsResponseElapsedMs = performance.now() - uiStartedAt
    const history = page.getByRole("listbox", { name: "Render history jobs" })
    await expect(page.locator(".cinema-deliver-history .cinema-deliver-section-heading small")).toHaveText("1000")
    const uiCountElapsedMs = performance.now() - uiStartedAt
    await expect(history.getByRole("option").first()).toBeVisible()
    const uiRowsElapsedMs = performance.now() - uiStartedAt
    const renderedOptionCount = await history.getByRole("option").count()
    console.info(
      `[deliver-history-performance] seed=${seeded?.seedElapsedMs?.toFixed(1)}ms api=${apiElapsedMs.toFixed(1)}ms ui-response=${uiJobsResponseElapsedMs.toFixed(1)}ms ui-count=${uiCountElapsedMs.toFixed(1)}ms ui-rows=${uiRowsElapsedMs.toFixed(1)}ms dom-options=${renderedOptionCount}`,
    )
    expect(uiRowsElapsedMs).toBeLessThan(1_000)
    expect(renderedOptionCount).toBeGreaterThan(0)
    expect(renderedOptionCount).toBeLessThan(100)
    await expect(history.getByRole("option").first()).toHaveAttribute("aria-setsize", "1000")
  })
})
