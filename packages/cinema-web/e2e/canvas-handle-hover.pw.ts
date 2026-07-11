import { expect, test } from "@playwright/test"

const externalCinemaURL = process.env.CINEMA_E2E_URL
const managedAgentPort = process.env.CINEMA_E2E_AGENT_PORT || "4187"
const agentBaseURL = `http://127.0.0.1:${managedAgentPort}`

test.describe("Canvas connection handles", () => {
  test.skip(Boolean(externalCinemaURL), "Handle assertions use the isolated managed Agent fixture.")

  test("keeps an unselected node handle interactive across the visual gap", async ({ page, request }) => {
    const projectResponse = await request.get(`${agentBaseURL}/e2e/project`)
    expect(projectResponse.ok()).toBe(true)
    const projectEnvelope = await projectResponse.json() as {
      data?: { cinemaURL?: string }
    }
    const cinemaURL = projectEnvelope.data?.cinemaURL
    expect(cinemaURL).toBeTruthy()

    const resetResponse = await request.post(`${agentBaseURL}/e2e/reset`)
    expect(resetResponse.ok()).toBe(true)
    await page.goto(cinemaURL!)

    const node = page.locator('.react-flow__node-cinemaNode[data-id="story-brief"]')
    const nodeSurface = node.locator(".cinema-text-card-node")
    const outputHandle = node.locator(".cinema-node-handle-output")
    await expect(node).toBeVisible()
    await expect(nodeSurface).not.toHaveClass(/is-selected/)

    await outputHandle.hover({ position: { x: 4, y: 18 } })
    await expect.poll(() => outputHandle.evaluate((element) => getComputedStyle(element).opacity)).toBe("1")
  })

  test("keeps both ends of an existing connection visible without hover", async ({ page, request }) => {
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
    const commandURL = `${agentBaseURL}/api/cinema/projects/${encodeURIComponent(projectID!)}/commands`
    const sourceResponse = await request.post(commandURL, {
      data: {
        id: "e2e-create-connected-image",
        type: "create-node-from-asset",
        actor: "canvas-handle-e2e",
        baseRevision: 0,
        nodeID: "connected-image-e2e",
        assetRef: {
          scope: { type: "project", projectID },
          assetID: "fixture-image-1",
        },
        position: { x: 620, y: 180 },
      },
    })
    expect(sourceResponse.ok()).toBe(true)
    const targetResponse = await request.post(commandURL, {
      data: {
        id: "e2e-create-connected-video",
        type: "create-node-from-asset",
        actor: "canvas-handle-e2e",
        baseRevision: 1,
        nodeID: "connected-video-e2e",
        assetRef: {
          scope: { type: "project", projectID },
          assetID: "fixture-video-1",
        },
        position: { x: 1040, y: 180 },
      },
    })
    expect(targetResponse.ok()).toBe(true)
    const connectResponse = await request.post(commandURL, {
      data: {
        id: "e2e-connect-image-video",
        type: "connect-nodes",
        actor: "canvas-handle-e2e",
        baseRevision: 2,
        edge: {
          id: "edge-connected-image-video-e2e",
          source: "connected-image-e2e",
          sourceHandle: "output",
          target: "connected-video-e2e",
          targetHandle: "input",
        },
      },
    })
    expect(connectResponse.ok()).toBe(true)

    await page.goto(cinemaURL!)
    await page.mouse.move(8, 8)
    const sourceNode = page.locator('.react-flow__node-cinemaNode[data-id="connected-image-e2e"]')
    const targetNode = page.locator('.react-flow__node-cinemaNode[data-id="connected-video-e2e"]')
    const sourceHandle = sourceNode.locator(".cinema-node-handle-output")
    const targetHandle = targetNode.locator(".cinema-node-handle-input")
    const unconnectedHandle = targetNode.locator(".cinema-node-handle-output")

    await expect(sourceNode).toBeVisible()
    await expect(targetNode).toBeVisible()
    await expect(sourceHandle).toHaveClass(/is-connected/)
    await expect(targetHandle).toHaveClass(/is-connected/)
    await expect(targetHandle).toHaveClass(/is-locked/)
    await expect.poll(() => sourceHandle.evaluate((element) => Number(getComputedStyle(element).opacity))).toBeGreaterThan(0)
    await expect.poll(() => targetHandle.evaluate((element) => Number(getComputedStyle(element).opacity))).toBeGreaterThan(0)
    await expect.poll(() => unconnectedHandle.evaluate((element) => getComputedStyle(element).opacity)).toBe("0")
  })
})
