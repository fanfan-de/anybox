import { expect, test, type Locator } from "@playwright/test"
import { writeFile } from "node:fs/promises"

const externalCinemaURL = process.env.CINEMA_E2E_URL
const deliverEnabled = process.env.VITE_CINEMA_DELIVER_DEV === "1"
const managedAgentPort = process.env.CINEMA_E2E_AGENT_PORT || "4187"
const agentBaseURL = `http://127.0.0.1:${managedAgentPort}`

type SubtitleFrameMetrics = {
  whitePixels: number
  minY: number | null
  maxY: number | null
  pngBase64: string
}

async function inspectSubtitleFrame(video: Locator, time: number): Promise<SubtitleFrameMetrics> {
  return await video.evaluate(async (element, targetTime) => {
    const media = element as HTMLVideoElement
    if (media.readyState < HTMLMediaElement.HAVE_METADATA) {
      await new Promise<void>((resolve) => media.addEventListener("loadedmetadata", () => resolve(), { once: true }))
    }
    media.currentTime = targetTime
    await new Promise<void>((resolve) => media.addEventListener("seeked", () => resolve(), { once: true }))
    const canvas = document.createElement("canvas")
    canvas.width = media.videoWidth
    canvas.height = media.videoHeight
    const context = canvas.getContext("2d", { willReadFrequently: true })!
    context.drawImage(media, 0, 0)
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
    let whitePixels = 0
    let minY: number | null = null
    let maxY: number | null = null
    for (let y = Math.floor(canvas.height * 0.45); y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        const offset = (y * canvas.width + x) * 4
        if (pixels[offset]! < 205 || pixels[offset + 1]! < 205 || pixels[offset + 2]! < 205) continue
        whitePixels += 1
        minY = minY === null ? y : Math.min(minY, y)
        maxY = maxY === null ? y : Math.max(maxY, y)
      }
    }
    return { whitePixels, minY, maxY, pngBase64: canvas.toDataURL("image/png").split(",")[1]! }
  }, time)
}

test.describe("Cinema subtitle burn-in", () => {
  test.skip(Boolean(externalCinemaURL) || !deliverEnabled, "Subtitle burn-in uses the isolated fixture and reviewed local media runtime.")

  test("renders reviewed CJK subtitles inside the safe area for a custom range", async ({ page, request }, testInfo) => {
    test.setTimeout(60_000)
    const fixture = await request.get(`${agentBaseURL}/e2e/project`)
    const envelope = await fixture.json() as { data: { projectID: string; cinemaURL: string } }
    expect((await request.post(`${agentBaseURL}/e2e/reset`)).ok()).toBe(true)
    const seed = await request.post(`${agentBaseURL}/e2e/seed-subtitle-deliver-timeline`)
    expect(seed.ok()).toBe(true)
    expect((await seed.json() as { data: unknown }).data).toMatchObject({
      timelineID: "subtitle-deliver-timeline",
      subtitleCues: 2,
    })

    await page.goto(envelope.data.cinemaURL)
    await page.getByRole("tab", { name: /^Deliver/ }).click()
    await expect(page.getByRole("heading", { name: "Subtitle delivery fixture" })).toBeVisible()
    await page.getByLabel("Subtitles").selectOption("subtitle-s1")
    await page.getByRole("option", { name: "Custom" }).click()
    await page.getByLabel("Start (s)").fill("0.25")
    await page.getByLabel("End (s)").fill("1.75")
    await page.getByRole("textbox", { name: /^Output name/ }).fill("Subtitle burn-in smoke")

    await expect(page.getByText("Ready", { exact: true })).toBeVisible({ timeout: 15_000 })
    await page.getByRole("button", { name: /Start render/ }).click()
    await expect(page.getByText("Output verified and registered in Assets.")).toBeVisible({ timeout: 30_000 })

    const outputPreview = page.locator("video[aria-label$='output preview']")
    await expect(outputPreview).toBeVisible()
    await expect.poll(async () => outputPreview.evaluate((video) => video.readyState >= HTMLMediaElement.HAVE_METADATA)).toBe(true)
    const duration = await outputPreview.evaluate((video) => video.duration)
    expect(duration).toBeGreaterThan(1.4)
    expect(duration).toBeLessThan(1.6)

    const firstCue = await inspectSubtitleFrame(outputPreview, 0.3)
    expect(firstCue.whitePixels).toBeGreaterThan(40)
    expect(firstCue.minY).not.toBeNull()
    expect(firstCue.maxY).toBeLessThan(170)
    await writeFile(testInfo.outputPath("subtitle-burn-in-cjk.png"), Buffer.from(firstCue.pngBase64, "base64"))

    const secondCue = await inspectSubtitleFrame(outputPreview, 1.0)
    expect(secondCue.whitePixels).toBeGreaterThan(40)
    expect(secondCue.minY).toBeLessThan(firstCue.minY! - 8)
    expect(secondCue.maxY).toBeLessThan(170)
    await writeFile(testInfo.outputPath("subtitle-burn-in-multiline.png"), Buffer.from(secondCue.pngBase64, "base64"))
    const previewURL = await outputPreview.getAttribute("src")
    expect(previewURL).toBeTruthy()
    const outputResponse = await request.get(previewURL!)
    expect(outputResponse.ok()).toBe(true)
    await writeFile(testInfo.outputPath("subtitle-burn-in-smoke.mp4"), await outputResponse.body())

    const jobsResponse = await request.get(
      `${agentBaseURL}/api/cinema/projects/${encodeURIComponent(envelope.data.projectID)}/timelines/subtitle-deliver-timeline/render-jobs`,
    )
    const jobs = (await jobsResponse.json() as { data: { items: Array<{ status: string; settings: unknown; executionRuntime?: unknown }> } }).data.items
    const expectedVideoEncoder = process.platform === "win32"
      ? "h264_mf"
      : process.platform === "darwin"
        ? "h264_videotoolbox"
        : "libx264"
    expect(jobs[0]).toMatchObject({
      status: "succeeded",
      executionRuntime: { videoEncoder: expectedVideoEncoder, audioEncoder: "aac" },
      settings: {
        range: { type: "custom", startUs: 250_000, endUs: 1_750_000 },
        subtitles: { mode: "burn-in", trackID: "subtitle-s1" },
      },
    })
  })
})
