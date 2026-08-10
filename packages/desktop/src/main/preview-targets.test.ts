import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  inferPreviewRenderer,
  handleLocalPreviewProtocolRequest,
  isPluginViewPreviewUrl,
  LOCAL_PREVIEW_PROTOCOL_SCHEMES,
  readPreviewText,
  resolveLocalPreviewProtocolRequest,
  resolvePluginViewPreviewOwner,
  resolvePluginViewPreviewTarget,
  resolvePreviewTarget,
  revokePluginViewPreviewRegistrations,
} from "./preview-targets"

const tempRoots: string[] = []

async function createTempWorkspace() {
  const root = await mkdtemp(path.join(os.tmpdir(), "anybox-preview-test-"))
  tempRoots.push(root)
  await mkdir(path.join(root, "artifacts"), { recursive: true })
  return root
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

describe("preview target resolver", () => {
  it("registers plugin previews for streaming audio and video", () => {
    expect(LOCAL_PREVIEW_PROTOCOL_SCHEMES).toEqual([
      {
        scheme: "anybox-preview",
        privileges: {
          standard: true,
          secure: true,
          supportFetchAPI: true,
          stream: true,
        },
      },
    ])
  })

  it("resolves explicit and implicit URLs without a workspace", async () => {
    await expect(resolvePreviewTarget({ value: "https://example.com/docs" })).resolves.toMatchObject({
      kind: "url",
      normalizedInput: "https://example.com/docs",
      renderer: "url-webview",
      safePreviewUrl: "https://example.com/docs",
    })

    await expect(resolvePreviewTarget({ value: "localhost:5173" })).resolves.toMatchObject({
      kind: "url",
      normalizedInput: "http://localhost:5173/",
      renderer: "url-webview",
    })
  })

  it("resolves artifact metadata and reads text previews inside the workspace", async () => {
    const workspaceRoot = await createTempWorkspace()
    const artifactRoot = path.join(workspaceRoot, "artifacts", "report-1")
    const entry = path.join(artifactRoot, "report.md")
    await mkdir(artifactRoot, { recursive: true })
    await writeFile(entry, "# Report\n\nBody", "utf8")
    await writeFile(path.join(artifactRoot, "artifact.json"), JSON.stringify({
      title: "Report",
      artifactType: "markdown",
      entry: "report.md",
      mime: "text/markdown; charset=utf-8",
    }), "utf8")

    const resolved = await resolvePreviewTarget({
      value: "agent://artifact/report-1",
      workspaceRoot,
    })
    const resolvedWorkspaceRoot = await realpath(workspaceRoot)

    expect(resolved).toMatchObject({
      artifactID: "report-1",
      artifactType: "markdown",
      kind: "artifact",
      renderer: "markdown-preview",
      textReadable: true,
      title: "Report",
      workspaceRoot: resolvedWorkspaceRoot,
    })
    await expect(readPreviewText({ path: resolved.entry!, workspaceRoot: resolvedWorkspaceRoot })).resolves.toMatchObject({
      content: "# Report\n\nBody",
      path: resolved.entry,
    })
  })

  it("serves local preview protocol URLs only within the registered root", async () => {
    const workspaceRoot = await createTempWorkspace()
    const artifactRoot = path.join(workspaceRoot, "artifacts", "html-1")
    await mkdir(artifactRoot, { recursive: true })
    await writeFile(path.join(artifactRoot, "index.html"), "<h1>Hello</h1>", "utf8")
    await writeFile(path.join(artifactRoot, "data.bin"), "binary", "utf8")
    await writeFile(path.join(workspaceRoot, "artifacts", "secret.txt"), "secret", "utf8")

    const resolved = await resolvePreviewTarget({
      value: "agent://artifact/html-1",
      workspaceRoot,
    })
    expect(resolved.renderer).toBe("html-preview")
    expect(resolved.safePreviewUrl).toMatch(/^anybox-preview:\/\/preview\//)

    await expect(resolveLocalPreviewProtocolRequest(resolved.safePreviewUrl!)).resolves.toMatchObject({
      ok: true,
      mimeType: "text/html; charset=utf-8",
    })

    const parsedUrl = new URL(resolved.safePreviewUrl!)
    const token = parsedUrl.pathname.split("/").filter(Boolean)[0]
    await expect(resolveLocalPreviewProtocolRequest(`anybox-preview://preview/${token}/%2e%2e%2fsecret.txt`)).resolves.toMatchObject({
      ok: false,
      status: 403,
    })
    await expect(resolveLocalPreviewProtocolRequest(`anybox-preview://preview/${token}/data.bin`)).resolves.toMatchObject({
      ok: false,
      status: 415,
    })
  })

  it("serves plugin Views and their package assets with a locked-down policy", async () => {
    const workspaceRoot = await createTempWorkspace()
    await mkdir(path.join(workspaceRoot, "web", "assets"), { recursive: true })
    await writeFile(path.join(workspaceRoot, "web", "index.html"), "<script type=\"module\" src=\"./assets/app.js\"></script>", "utf8")
    await writeFile(path.join(workspaceRoot, "web", "assets", "app.js"), "document.body.textContent = 'ready'", "utf8")

    const resolved = await resolvePluginViewPreviewTarget({
      entry: "./web/index.html",
      packageRoot: workspaceRoot,
      pluginID: "react-sidebar-proof",
      viewID: "main",
    })
    expect(resolved.renderer).toBe("html-preview")
    expect(isPluginViewPreviewUrl(resolved.safePreviewUrl!)).toBe(true)
    expect(resolvePluginViewPreviewOwner(resolved.safePreviewUrl!)).toEqual({
      pluginID: "react-sidebar-proof",
      viewID: "main",
    })

    const parsedUrl = new URL(resolved.safePreviewUrl!)
    const token = parsedUrl.hostname
    await expect(resolveLocalPreviewProtocolRequest(
      `anybox-preview://${token}/web/assets/app.js`,
    )).resolves.toMatchObject({
      ok: true,
      mimeType: "text/javascript; charset=utf-8",
      purpose: "plugin-view",
    })
    await expect(resolveLocalPreviewProtocolRequest(
      `anybox-preview://${token}/%2e%2e%2foutside.js`,
    )).resolves.toMatchObject({ ok: false })

    const response = await handleLocalPreviewProtocolRequest(new Request(resolved.safePreviewUrl!))
    expect(response.headers.get("content-security-policy")).toContain("connect-src 'self'")
    expect(response.headers.get("content-security-policy")).toContain("script-src 'self'")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")

    const proxyPluginRuntimeRequest = vi.fn(async () => new Response("runtime-ready", { status: 202 }))
    const runtimeUrl = new URL("/__anybox_runtime__/api/projects?limit=2", resolved.safePreviewUrl!).toString()
    const runtimeResponse = await handleLocalPreviewProtocolRequest(
      new Request(runtimeUrl, { method: "POST", body: "{}" }),
      { proxyPluginRuntimeRequest },
    )
    expect(runtimeResponse.status).toBe(202)
    expect(await runtimeResponse.text()).toBe("runtime-ready")
    expect(proxyPluginRuntimeRequest).toHaveBeenCalledWith(expect.objectContaining({
      pluginID: "react-sidebar-proof",
      requestPath: "/api/projects?limit=2",
      viewID: "main",
    }))

    const refreshed = await resolvePluginViewPreviewTarget({
      entry: "./web/index.html",
      packageRoot: workspaceRoot,
      pluginID: "react-sidebar-proof",
      viewID: "main",
    })
    expect(refreshed.safePreviewUrl).not.toBe(resolved.safePreviewUrl)
    await expect(resolveLocalPreviewProtocolRequest(resolved.safePreviewUrl!)).resolves.toMatchObject({
      ok: false,
      status: 404,
    })
    await expect(resolveLocalPreviewProtocolRequest(refreshed.safePreviewUrl!)).resolves.toMatchObject({ ok: true })

    revokePluginViewPreviewRegistrations("react-sidebar-proof")
    await expect(resolveLocalPreviewProtocolRequest(refreshed.safePreviewUrl!)).resolves.toMatchObject({
      ok: false,
      status: 404,
    })
  })

  it.skipIf(process.platform !== "win32")("normalizes slash-prefixed Windows absolute paths before resolving workspace files", async () => {
    const workspaceRoot = await createTempWorkspace()
    const entry = path.join(workspaceRoot, "snake-game.html")
    await writeFile(entry, "<!doctype html><title>Snake</title>", "utf8")

    const slashPrefixedPath = `/${entry.replace(/\\/g, "/")}`
    const resolved = await resolvePreviewTarget({
      value: slashPrefixedPath,
      workspaceRoot,
    })

    await expect(realpath(entry)).resolves.toBe(resolved.path)
    expect(resolved.normalizedInput).toBe("snake-game.html")
    expect(resolved.renderer).toBe("html-preview")
  })

  it("infers renderers from common preview file types", () => {
    expect(inferPreviewRenderer("README.md")).toBe("markdown-preview")
    expect(inferPreviewRenderer("index.html")).toBe("html-preview")
    expect(inferPreviewRenderer("diagram.svg")).toBe("svg-preview")
    expect(inferPreviewRenderer("data.json")).toBe("json-viewer")
    expect(inferPreviewRenderer("rows.csv")).toBe("table-preview")
    expect(inferPreviewRenderer("image.png")).toBe("image-preview")
    expect(inferPreviewRenderer("source.ts")).toBe("code-viewer")
    expect(inferPreviewRenderer("archive.zip")).toBe("system-open")
  })
})
