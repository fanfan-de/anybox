import { expect, test } from "@playwright/test"

const externalCinemaURL = process.env.CINEMA_E2E_URL
const managedAgentPort = process.env.CINEMA_E2E_AGENT_PORT || "4187"
const agentBaseURL = `http://127.0.0.1:${managedAgentPort}`

test.describe("Asset video node actions", () => {
  test.skip(Boolean(externalCinemaURL), "Asset node assertions use the isolated managed Agent fixture.")

  test("shows and runs the delete action for a ready video node", async ({ page, request }) => {
    const projectResponse = await request.get(`${agentBaseURL}/e2e/project`)
    expect(projectResponse.ok()).toBe(true)
    const projectEnvelope = await projectResponse.json() as {
      data?: { projectID?: string; cinemaURL?: string }
    }
    const projectID = projectEnvelope.data?.projectID
    const cinemaURL = projectEnvelope.data?.cinemaURL
    expect(projectID).toBeTruthy()
    expect(cinemaURL).toBeTruthy()

    const resetResponse = await request.post(`${agentBaseURL}/e2e/reset`)
    expect(resetResponse.ok()).toBe(true)
    const createResponse = await request.post(
      `${agentBaseURL}/api/cinema/projects/${encodeURIComponent(projectID!)}/commands`,
      {
        data: {
          id: "e2e-create-ready-video",
          type: "create-node-from-asset",
          actor: "asset-video-node-actions-e2e",
          baseRevision: 0,
          nodeID: "ready-video-e2e",
          assetRef: {
            scope: { type: "project", projectID },
            assetID: "fixture-video-1",
          },
          position: { x: 620, y: 180 },
        },
      },
    )
    expect(createResponse.ok()).toBe(true)
    const createGenerationNodeResponse = await request.post(
      `${agentBaseURL}/api/cinema/projects/${encodeURIComponent(projectID!)}/commands`,
      {
        data: {
          id: "e2e-create-generation-video",
          type: "create-node",
          actor: "asset-video-node-actions-e2e",
          baseRevision: 1,
          node: {
            id: "generation-video-e2e",
            type: "video",
            title: "Video generation fixture",
            position: { x: 620, y: 520 },
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
          },
        },
      },
    )
    expect(createGenerationNodeResponse.ok()).toBe(true)

    await page.goto(cinemaURL!)
    const node = page.locator('.react-flow__node-cinemaNode[data-id="ready-video-e2e"]')
    const nodeSurface = node.locator(".cinema-asset-ready-node")
    const preview = node.locator(".cinema-asset-ready-preview")
    const dragHandle = node.locator(".cinema-node-type.is-drag-handle")
    const generationNode = page.locator('.react-flow__node-cinemaNode[data-id="generation-video-e2e"]')
    const generationSurface = generationNode.locator(".cinema-video-gen-node")
    const deleteButton = node.getByRole("button", { name: "Delete node" })
    await expect(node).toBeVisible()
    await expect(generationNode).toBeVisible()
    await expect(nodeSurface).toHaveClass(/cinema-video-gen-node/)
    await expect(preview).toHaveClass(/cinema-video-gen-preview/)
    await expect(node.getByRole("button", { name: "Play preview" })).toBeVisible()
    await expect(dragHandle).not.toHaveClass(/nodrag/)
    await expect.poll(() => preview.evaluate((element) => getComputedStyle(element).borderRadius)).toBe("14px")
    const comparableSurfaceStyle = (element: Element) => {
      const style = getComputedStyle(element)
      return {
        backgroundColor: style.backgroundColor,
        borderRadius: style.borderRadius,
        borderTopWidth: style.borderTopWidth,
        boxShadow: style.boxShadow,
        gap: style.gap,
        padding: style.padding,
      }
    }
    expect(await nodeSurface.evaluate(comparableSurfaceStyle)).toEqual(
      await generationSurface.evaluate(comparableSurfaceStyle),
    )

    await page.evaluate(() => window.localStorage.setItem("cinema-theme", "light"))
    await page.reload()
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light")
    await expect(node).toBeVisible()
    await expect(node.getByRole("button", { name: "Play preview" })).toBeVisible()
    expect(await nodeSurface.evaluate(comparableSurfaceStyle)).toEqual(
      await generationSurface.evaluate(comparableSurfaceStyle),
    )

    const nodeBoundsBeforeDrag = await node.boundingBox()
    const dragHandleBounds = await dragHandle.boundingBox()
    expect(nodeBoundsBeforeDrag).not.toBeNull()
    expect(dragHandleBounds).not.toBeNull()
    const dragStartX = dragHandleBounds!.x + Math.min(20, dragHandleBounds!.width / 2)
    const dragStartY = dragHandleBounds!.y + dragHandleBounds!.height / 2
    await page.mouse.move(
      dragStartX,
      dragStartY,
    )
    await page.mouse.down()
    await page.mouse.move(
      dragStartX - 80,
      dragStartY + 30,
      { steps: 8 },
    )
    await page.mouse.up()
    await expect.poll(async () => (await node.boundingBox())?.x ?? Number.POSITIVE_INFINITY).toBeLessThan(
      nodeBoundsBeforeDrag!.x - 30,
    )

    await nodeSurface.hover({ position: { x: 12, y: 12 } })
    await expect.poll(() => deleteButton.evaluate((element) => getComputedStyle(element).opacity)).toBe("1")
    await expect.poll(() => deleteButton.evaluate((element) => getComputedStyle(element).pointerEvents)).toBe("auto")

    await deleteButton.focus()
    await deleteButton.press("Enter")
    await expect(node).toHaveCount(0)
  })
})
