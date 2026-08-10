import { expect, test, type APIRequestContext, type Page } from "@playwright/test"

const externalCinemaURL = process.env.CINEMA_E2E_URL
const managedAgentPort = process.env.CINEMA_E2E_AGENT_PORT || "4187"
const agentBaseURL = `http://127.0.0.1:${managedAgentPort}`

type FixtureProject = {
  projectID: string
  cinemaURL: string
}

const imageModels = [
  {
    value: "e2e/image-a",
    providerID: "e2e",
    modelID: "image-a",
    label: "E2E Image A",
    providerLabel: "E2E Provider",
    available: true,
    supportsImageInput: false,
    formSpec: {
      providerID: "e2e",
      modelID: "image-a",
      mode: "text-to-image",
      output: "image",
      controls: [
        {
          type: "number",
          key: "count",
          label: "Count",
          required: false,
          min: 1,
          max: 4,
          defaultValue: 1,
        },
        {
          type: "select",
          key: "aspect_ratio",
          label: "Aspect ratio",
          required: false,
          options: ["auto", "16:9", "9:16"],
          defaultValue: "auto",
        },
        {
          type: "select",
          key: "resolution",
          label: "Resolution",
          required: false,
          options: ["1K", "2K"],
          defaultValue: "1K",
        },
        {
          type: "select",
          key: "style",
          label: "Style",
          required: false,
          options: ["natural", "cinematic"],
          labels: { natural: "Natural", cinematic: "Cinematic" },
          defaultValue: "natural",
        },
      ],
    },
  },
  {
    value: "e2e/image-b",
    providerID: "e2e",
    modelID: "image-b",
    label: "E2E Image B",
    providerLabel: "E2E Provider",
    available: true,
    supportsImageInput: false,
    formSpec: {
      providerID: "e2e",
      modelID: "image-b",
      mode: "text-to-image",
      output: "image",
      controls: [
        {
          type: "number",
          key: "count",
          label: "Count",
          required: false,
          min: 1,
          max: 4,
          defaultValue: 1,
        },
        {
          type: "select",
          key: "aspect_ratio",
          label: "Aspect ratio",
          required: false,
          options: ["auto", "16:9", "9:16"],
          defaultValue: "auto",
        },
        {
          type: "select",
          key: "resolution",
          label: "Resolution",
          required: false,
          options: ["1K", "2K"],
          defaultValue: "1K",
        },
        {
          type: "select",
          key: "style",
          label: "Style",
          required: false,
          options: ["natural", "cinematic"],
          labels: { natural: "Natural", cinematic: "Cinematic" },
          defaultValue: "natural",
        },
      ],
    },
  },
]

const videoInputCombinations = [
  {
    mode: "text-to-video",
    label: "Text to video",
    requiredModalities: ["text"],
    optionalModalities: [],
    inputs: [
      {
        role: "prompt",
        modality: "text",
        required: true,
        minCount: 1,
        label: "Prompt",
        note: "Describe the video to generate.",
      },
      {
        role: "negative_prompt",
        modality: "text",
        required: false,
        minCount: 0,
        label: "Negative prompt",
        uiControl: "textarea",
        default: "",
      },
      {
        role: "aspect_ratio",
        modality: "string",
        required: false,
        minCount: 0,
        options: ["16:9", "9:16"],
        default: "16:9",
      },
      {
        role: "duration",
        modality: "number",
        required: false,
        minCount: 0,
        options: [5, 10],
        default: 5,
      },
      {
        role: "resolution",
        modality: "string",
        required: false,
        minCount: 0,
        options: ["720p", "1080p"],
        default: "720p",
      },
      {
        role: "motion_style",
        modality: "string",
        required: false,
        minCount: 0,
        label: "Motion style",
        uiControl: "select",
        options: ["natural", "dynamic"],
        default: "natural",
      },
    ],
    requirements: [],
  },
  {
    mode: "frames-to-video",
    label: "First and last frame",
    requiredModalities: ["text", "image"],
    optionalModalities: ["image"],
    inputs: [
      {
        role: "prompt",
        modality: "text",
        required: true,
        minCount: 1,
        label: "Prompt",
        note: "Describe motion between the frames.",
      },
      {
        role: "negative_prompt",
        modality: "text",
        required: false,
        minCount: 0,
        label: "Negative prompt",
        uiControl: "textarea",
        default: "",
      },
      {
        role: "first_frame_image",
        modality: "image",
        required: true,
        minCount: 1,
        maxCount: 1,
        label: "First frame",
      },
      {
        role: "last_frame_image",
        modality: "image",
        required: false,
        minCount: 0,
        maxCount: 1,
        label: "Last frame",
      },
      {
        role: "aspect_ratio",
        modality: "string",
        required: false,
        minCount: 0,
        options: ["16:9", "9:16"],
        default: "16:9",
      },
      {
        role: "duration",
        modality: "number",
        required: false,
        minCount: 0,
        options: [5, 10],
        default: 5,
      },
      {
        role: "resolution",
        modality: "string",
        required: false,
        minCount: 0,
        options: ["720p", "1080p"],
        default: "720p",
      },
      {
        role: "motion_style",
        modality: "string",
        required: false,
        minCount: 0,
        label: "Motion style",
        uiControl: "select",
        options: ["natural", "dynamic"],
        default: "natural",
      },
    ],
    requirements: [],
  },
]

const videoProviders = [
  {
    manifest: {
      id: "e2e-video",
      name: "E2E Video Provider",
      regions: [],
      requiresCredential: false,
      models: [
        {
          id: "video-a",
          label: "E2E Video A",
          modes: ["text-to-video", "frames-to-video"],
          modalities: { input: ["text", "image"], output: ["video"] },
          durations: [5, 10],
          aspectRatios: ["16:9", "9:16"],
          resolutions: ["720p", "1080p"],
          inputCombinations: videoInputCombinations,
          pricing: [],
          formSpecs: [],
          parameterSchema: {},
        },
        {
          id: "video-b",
          label: "E2E Video B",
          modes: ["text-to-video", "frames-to-video"],
          modalities: { input: ["text", "image"], output: ["video"] },
          durations: [5, 10],
          aspectRatios: ["16:9", "9:16"],
          resolutions: ["720p", "1080p"],
          inputCombinations: videoInputCombinations,
          pricing: [],
          formSpecs: [],
          parameterSchema: {},
        },
      ],
    },
    auth: {
      providerID: "e2e-video",
      credentialProviderID: "e2e-video",
      requiresCredential: false,
      connected: true,
      status: "connected",
    },
    runtime: {
      adapterAvailable: true,
      adapterID: "e2e-video",
      supportedModes: ["text-to-video", "frames-to-video"],
    },
  },
]

async function readFixtureProject(request: APIRequestContext): Promise<FixtureProject> {
  const response = await request.get(`${agentBaseURL}/e2e/project`)
  expect(response.ok()).toBe(true)
  const envelope = await response.json() as { success: boolean; data?: FixtureProject }
  expect(envelope.success).toBe(true)
  expect(envelope.data?.projectID).toBeTruthy()
  expect(envelope.data?.cinemaURL).toBeTruthy()
  return envelope.data!
}

async function mockGenerationCatalogs(page: Page) {
  await page.route(/\/api\/cinema\/projects\/[^/]+\/image-models$/, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      success: true,
      data: {
        items: imageModels,
        selection: { image_model: imageModels[0]!.value },
        effectiveModel: imageModels[0],
      },
    }),
  }))
  await page.route(/\/api\/cinema\/projects\/[^/]+\/video-providers$/, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ success: true, data: videoProviders }),
  }))
}

async function createNode(
  request: APIRequestContext,
  projectID: string,
  revision: number,
  node: Record<string, unknown>,
) {
  const response = await request.post(
    `${agentBaseURL}/api/cinema/projects/${encodeURIComponent(projectID)}/commands`,
    {
      data: {
        id: `e2e-create-${String(node.id)}`,
        type: "create-node",
        actor: "composer-e2e",
        baseRevision: revision,
        node,
      },
    },
  )
  expect(response.ok()).toBe(true)
}

async function openGenerationComposerProject(page: Page, request: APIRequestContext) {
  await mockGenerationCatalogs(page)
  const project = await readFixtureProject(request)
  const reset = await request.post(`${agentBaseURL}/e2e/reset`)
  expect(reset.ok()).toBe(true)

  await createNode(request, project.projectID, 0, {
    id: "image-composer-e2e",
    type: "image",
    title: "Image Composer Fixture",
    position: { x: 620, y: 80 },
    size: { width: 340, height: 260 },
    data: {
      prompt: "",
      size: "1024x1024",
      count: 1,
      status: "idle",
      parameters: {},
    },
  })
  await createNode(request, project.projectID, 1, {
    id: "video-composer-e2e",
    type: "video",
    title: "Video Composer Fixture",
    position: { x: 620, y: 480 },
    size: { width: 440, height: 270 },
    data: {
      text: "",
      mode: "text-to-video",
      aspectRatio: "16:9",
      duration: 5,
      resolution: "720p",
      status: "draft",
      parameters: {},
    },
  })

  await page.goto(project.cinemaURL)
  await expect(page.locator('.react-flow__node-cinemaNode[data-id="image-composer-e2e"]')).toBeVisible()
  await expect(page.locator('.react-flow__node-cinemaNode[data-id="video-composer-e2e"]')).toBeVisible()
}

async function expectAdvancedBeforeFooter(composer: ReturnType<Page["locator"]>, panelSelector: string, footerSelector: string) {
  await expect(composer.locator(panelSelector)).toBeVisible()
  expect(await composer.evaluate((element, selectors) => {
    const panel = element.querySelector(selectors.panel)
    const footer = element.querySelector(selectors.footer)
    return Boolean(panel && footer && (panel.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING))
  }, { panel: panelSelector, footer: footerSelector })).toBe(true)
}

async function expectComposerInsideViewport(page: Page, composer: ReturnType<Page["locator"]>) {
  const viewport = page.viewportSize()
  const bounds = await composer.boundingBox()
  expect(viewport).not.toBeNull()
  expect(bounds).not.toBeNull()
  expect(bounds!.x).toBeGreaterThanOrEqual(-1)
  expect(bounds!.y).toBeGreaterThanOrEqual(-1)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport!.width + 1)
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport!.height + 1)
}

test.describe("Generation composers", () => {
  test.skip(Boolean(externalCinemaURL), "Composer assertions use the isolated managed Agent fixture.")

  test("keeps image settings in one row and edits canvas specification in a secondary panel", async ({ page, request }) => {
    await openGenerationComposerProject(page, request)
    await page.locator('.react-flow__node-cinemaNode[data-id="image-composer-e2e"]').click()

    const composer = page.locator(".cinema-image-composer")
    const footer = composer.locator(".cinema-image-composer-footer")
    await expect(composer).toBeVisible()
    await expect(composer.getByRole("textbox", { name: "Image prompt" })).toBeVisible()
    await expect(composer.locator(".cinema-image-advanced-panel")).toHaveCount(0)

    const modelTrigger = footer.getByRole("button", { name: "Image model" })
    const canvasSpecTrigger = footer.getByRole("button", { name: "Canvas specification" })
    const countTrigger = footer.getByRole("button", { name: "Count" })
    const primaryControls = [
      modelTrigger,
      canvasSpecTrigger,
      countTrigger,
      footer.getByRole("button", { name: "Advanced" }),
      footer.getByRole("button", { name: "Generate image" }),
    ]
    const primaryControlBounds = await Promise.all(primaryControls.map((control) => control.boundingBox()))
    for (const bounds of primaryControlBounds) expect(bounds).not.toBeNull()
    for (let index = 1; index < primaryControlBounds.length; index += 1) {
      expect(primaryControlBounds[index]!.x).toBeGreaterThan(primaryControlBounds[index - 1]!.x)
      expect(Math.abs(
        primaryControlBounds[index]!.y + primaryControlBounds[index]!.height / 2
          - primaryControlBounds[0]!.y - primaryControlBounds[0]!.height / 2,
      )).toBeLessThanOrEqual(1)
    }
    await expect(canvasSpecTrigger).toContainText("Auto · 1K")
    await expect(countTrigger).toContainText("×1")
    await expect(footer.getByRole("button", { name: "Resolution" })).toHaveCount(0)
    await expect(footer.getByRole("button", { name: "Aspect Ratio" })).toHaveCount(0)

    await canvasSpecTrigger.click()
    const canvasSpecPanel = page.getByRole("dialog", { name: "Canvas specification" })
    await expect(canvasSpecPanel).toBeVisible()
    await expect(canvasSpecPanel.getByRole("radiogroup", { name: "Aspect Ratio" })).toBeVisible()
    await expect(canvasSpecPanel.getByRole("radiogroup", { name: "Resolution" })).toBeVisible()
    await canvasSpecPanel.getByRole("radio", { name: "16:9" }).click()
    await canvasSpecPanel.getByRole("radio", { name: "2K" }).click()
    await expect(canvasSpecTrigger).toContainText("16:9 · 2K")
    await expectComposerInsideViewport(page, canvasSpecPanel)
    await canvasSpecPanel.getByRole("radio", { name: "2K" }).press("Escape")
    await expect(canvasSpecPanel).toHaveCount(0)
    await expect(canvasSpecTrigger).toBeFocused()

    await expect(modelTrigger).toContainText("E2E Image A")
    await modelTrigger.click()
    await page.getByRole("option", { name: /E2E Image B/ }).click()
    await expect(modelTrigger).toContainText("E2E Image B")

    await composer.getByRole("button", { name: "Advanced" }).click()
    await expectAdvancedBeforeFooter(composer, ".cinema-image-advanced-panel", ".cinema-image-composer-footer")

    const styleTrigger = composer.getByRole("button", { name: "Style" })
    await styleTrigger.click()
    await page.getByRole("option", { name: "Cinematic" }).click()
    await expect(styleTrigger).toContainText("Cinematic")

    await modelTrigger.click()
    await page.getByRole("option", { name: /E2E Image B/ }).click()
    await expect(styleTrigger).toContainText("Cinematic")

    await modelTrigger.click()
    await page.getByRole("option", { name: /E2E Image B/ }).press("Escape")
    await expect(page.getByRole("listbox", { name: "Image model" })).toHaveCount(0)
    await expect(composer).toBeVisible()
    await expect(modelTrigger).toBeFocused()
  })

  test("keeps video settings in one row and edits video specification in a secondary panel", async ({ page, request }) => {
    await openGenerationComposerProject(page, request)
    await page.locator('.react-flow__node-cinemaNode[data-id="video-composer-e2e"]').click()

    const composer = page.locator(".cinema-video-gen-composer")
    const footer = composer.locator(".cinema-video-composer-footer")
    await expect(composer).toBeVisible()
    await expect(composer.getByRole("textbox", { name: "Video prompt" })).toBeVisible()
    await expect(composer.locator(".cinema-video-advanced-panel")).toHaveCount(0)

    const modelTrigger = footer.getByRole("button", { name: "Video model" })
    const videoSpecTrigger = footer.getByRole("button", { name: "Video specification" })
    const durationTrigger = footer.getByRole("button", { name: "Duration" })
    const primaryControls = [
      modelTrigger,
      videoSpecTrigger,
      durationTrigger,
      footer.getByRole("button", { name: "Advanced" }),
      footer.getByRole("button", { name: "Generate video" }),
    ]
    const primaryControlBounds = await Promise.all(primaryControls.map((control) => control.boundingBox()))
    for (const bounds of primaryControlBounds) expect(bounds).not.toBeNull()
    for (let index = 1; index < primaryControlBounds.length; index += 1) {
      expect(primaryControlBounds[index]!.x).toBeGreaterThan(primaryControlBounds[index - 1]!.x)
      expect(Math.abs(
        primaryControlBounds[index]!.y + primaryControlBounds[index]!.height / 2
          - primaryControlBounds[0]!.y - primaryControlBounds[0]!.height / 2,
      )).toBeLessThanOrEqual(1)
    }
    await expect(videoSpecTrigger).toContainText("16:9 · 720p")
    await expect(durationTrigger).toContainText("5s")
    await expect(footer.getByRole("button", { name: "Aspect ratio" })).toHaveCount(0)
    await expect(footer.getByRole("button", { name: "Quality mode" })).toHaveCount(0)

    await videoSpecTrigger.click()
    const videoSpecPanel = page.getByRole("dialog", { name: "Video specification" })
    await expect(videoSpecPanel).toBeVisible()
    await expect(videoSpecPanel.getByRole("radiogroup", { name: "Ratio" })).toBeVisible()
    await expect(videoSpecPanel.getByRole("radiogroup", { name: "Quality" })).toBeVisible()
    await videoSpecPanel.getByRole("radio", { name: "9:16" }).click()
    await videoSpecPanel.getByRole("radio", { name: "1080p" }).click()
    await expect(videoSpecTrigger).toContainText("9:16 · 1080p")
    await expectComposerInsideViewport(page, videoSpecPanel)
    await videoSpecPanel.getByRole("radio", { name: "1080p" }).press("Escape")
    await expect(videoSpecPanel).toHaveCount(0)
    await expect(videoSpecTrigger).toBeFocused()

    await expect(modelTrigger).toContainText("E2E Video A")
    await modelTrigger.click()
    await page.getByRole("option", { name: /E2E Video B/ }).click()
    await expect(modelTrigger).toContainText("E2E Video B")

    const tablist = composer.getByRole("tablist", { name: "Video generation mode" })
    const textTab = tablist.getByRole("tab", { name: "Text to video" })
    const framesTab = tablist.getByRole("tab", { name: "First and last frame" })
    const panel = composer.getByRole("tabpanel")
    await expect(textTab).toHaveAttribute("aria-selected", "true")
    await expect(textTab).toHaveAttribute("tabindex", "0")
    await expect(framesTab).toHaveAttribute("aria-selected", "false")
    await expect(framesTab).toHaveAttribute("tabindex", "-1")
    await expect(textTab).toHaveAttribute("aria-controls", await panel.getAttribute("id") ?? "")
    await expect(panel).toHaveAttribute("aria-labelledby", await textTab.getAttribute("id") ?? "")

    await textTab.focus()
    await textTab.press("ArrowRight")
    await expect(framesTab).toBeFocused()
    await expect(framesTab).toHaveAttribute("aria-selected", "true")
    await expect(framesTab).toHaveAttribute("tabindex", "0")
    await expect(textTab).toHaveAttribute("tabindex", "-1")
    await expect(panel).toHaveAttribute("aria-labelledby", await framesTab.getAttribute("id") ?? "")

    const firstFrameSlot = panel.locator('.cinema-video-input-slot[data-slot-kind="startFrame"]')
    const lastFrameSlot = panel.locator('.cinema-video-input-slot[data-slot-kind="endFrame"]')
    await expect(firstFrameSlot.locator(".cinema-video-input-slot-label")).toHaveText("First frame")
    await expect(lastFrameSlot.locator(".cinema-video-input-slot-label")).toHaveText("Last frame")
    await expect(firstFrameSlot.locator(".cinema-video-input-slot-label")).toBeVisible()
    await expect(lastFrameSlot.locator(".cinema-video-input-slot-label")).toBeVisible()

    await framesTab.press("Home")
    await expect(textTab).toBeFocused()
    await expect(textTab).toHaveAttribute("aria-selected", "true")
    await textTab.press("End")
    await expect(framesTab).toBeFocused()
    await expect(framesTab).toHaveAttribute("aria-selected", "true")

    await composer.getByRole("button", { name: "Advanced" }).click()
    await expectAdvancedBeforeFooter(composer, ".cinema-video-advanced-panel", ".cinema-video-composer-footer")

    const motionStyleTrigger = composer.getByRole("button", { name: "Motion style" })
    await motionStyleTrigger.click()
    await page.getByRole("option", { name: "dynamic" }).click()
    await expect(motionStyleTrigger).toContainText("dynamic")
    await framesTab.click()
    await expect(motionStyleTrigger).toContainText("dynamic")

  })

  test("localizes the complete video composer in Chinese", async ({ page, request }) => {
    await page.addInitScript(() => window.localStorage.setItem("cinema-locale", "zh-CN"))
    await openGenerationComposerProject(page, request)

    const videoNode = page.locator('.react-flow__node-cinemaNode[data-id="video-composer-e2e"]')
    await expect(videoNode.getByText("暂无视频")).toBeVisible()
    await videoNode.click()

    const composer = page.locator(".cinema-video-gen-composer")
    await expect(composer).toBeVisible()
    await expect(composer.getByRole("textbox", { name: "视频提示词" })).toHaveAttribute(
      "placeholder",
      "描述内容、动作、镜头和画面变化……",
    )
    await expect(composer.getByRole("button", { name: "视频模型" })).toBeVisible()
    await expect(composer.getByRole("button", { name: "视频规格" })).toBeVisible()
    await expect(composer.getByRole("button", { name: "时长" })).toBeVisible()
    await expect(composer.getByRole("button", { name: "高级" })).toBeVisible()
    await expect(composer.getByRole("button", { name: "生成视频" })).toBeVisible()

    const tablist = composer.getByRole("tablist", { name: "视频生成模式" })
    await expect(tablist.getByRole("tab", { name: "文生视频" })).toBeVisible()
    const framesTab = tablist.getByRole("tab", { name: "首尾帧生视频" })
    await framesTab.click()

    const panel = composer.getByRole("tabpanel")
    await expect(panel.locator('.cinema-video-input-slot[data-slot-kind="startFrame"] .cinema-video-input-slot-label')).toHaveText("首帧")
    await expect(panel.locator('.cinema-video-input-slot[data-slot-kind="endFrame"] .cinema-video-input-slot-label')).toHaveText("尾帧")
    await expect(panel.locator('.cinema-video-input-slot[data-slot-kind="startFrame"] .cinema-video-input-slot-value')).toHaveAttribute("title", "导入或连接首帧图片。")
    await expect(panel.locator('.cinema-video-input-slot[data-slot-kind="endFrame"] .cinema-video-input-slot-value')).toHaveAttribute("title", "导入或连接尾帧图片。")
    await expect(panel.locator('.cinema-video-input-slot[data-slot-kind="startFrame"] .cinema-video-input-slot-required')).toHaveText("必填")
  })
})
