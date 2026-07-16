import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { Hono } from "hono"
import { z } from "zod"
import type {
  RegistryFileContent,
  RegistryProviderDescriptor,
  RegistrySkillSummary,
} from "@anybox/shared/skill-registry"
import { SkillRegistryCatalog } from "#skill/registry/catalog.ts"
import { RegistryPersistentCache } from "#skill/registry/cache.ts"
import { ClawHubProvider } from "#skill/registry/clawhub.ts"
import { RegistryProviderRequestError } from "#skill/registry/provider.ts"
import { SkillHubProvider } from "#skill/registry/skillhub.ts"
import type {
  RegistryProviderSearchInput,
  RegistryFetch,
  SkillRegistryProvider,
} from "#skill/registry/types.ts"
import { SkillRegistryRoutes } from "#server/routes/skill-registry.ts"
import { compareRegistryFiles, managedErrorStatus } from "#server/usecases/skill-registry.ts"
import type { AppEnv } from "#server/types.ts"

const fixtureRoot = resolve(import.meta.dir, "fixtures", "skill-registry")
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })))
})

async function fixture(name: string) {
  return await Bun.file(join(fixtureRoot, name)).json()
}

function jsonResponse(payload: unknown, init: ResponseInit = {}) {
  const response = new Response(JSON.stringify(payload), init)
  response.headers.set("content-type", "application/json")
  return response
}

function searchInput(overrides: Partial<RegistryProviderSearchInput> = {}): RegistryProviderSearchInput {
  return {
    query: "pdf",
    limit: 20,
    sort: "relevance",
    safeOnly: true,
    ...overrides,
  }
}

describe("ClawHub registry provider", () => {
  test("isolates malformed search items and preserves owner-scoped identities", async () => {
    const payload = await fixture("clawhub-search.json")
    const provider = new ClawHubProvider({
      fetch: async () => jsonResponse(payload),
    })

    const result = await provider.search(searchInput())

    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({
      id: "registry:clawhub:awspace/pdf",
      provider: "clawhub",
      remoteId: "awspace/pdf",
      slug: "pdf",
      canonicalUrl: "https://clawhub.ai/awspace/skills/pdf",
      iconUrl: "https://avatars.githubusercontent.com/u/1?v=4",
      author: {
        handle: "awspace",
        displayName: "AW Space",
        avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
      },
    })
    expect(result.errors).toEqual([expect.objectContaining({
      provider: "clawhub",
      code: "INVALID_RESPONSE",
    })])
  })

  test("reads detail, versions, version files, text content, scan state, and archive descriptor", async () => {
    const [detail, versions, versionDetail, scan] = await Promise.all([
      fixture("clawhub-detail.json"),
      fixture("clawhub-versions.json"),
      fixture("clawhub-version-detail.json"),
      fixture("clawhub-scan.json"),
    ])
    const requested: Array<{ url: URL; method: string }> = []
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input.toString())
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase()
      requested.push({ url, method })
      if (method === "HEAD" && url.pathname === "/api/v1/download") {
        return new Response(null, {
          headers: {
            "content-type": "application/zip",
            "x-clawhub-artifact-sha256": "4991fa905d1b4d6d2995d44812f6859297d385965b4078be001c2bfd0908017c",
          },
        })
      }
      if (url.pathname.endsWith("/scan")) return jsonResponse(scan)
      if (url.pathname.endsWith("/versions/0.1.0")) return jsonResponse(versionDetail)
      if (url.pathname.endsWith("/versions")) return jsonResponse(versions)
      if (url.pathname.endsWith("/file")) {
        return new Response("---\nname: pdf\n---\n\n# PDF Toolkit\n", {
          headers: { "content-type": "text/plain" },
        })
      }
      if (url.pathname.endsWith("/skills/pdf")) return jsonResponse(detail)
      return new Response("Not found", { status: 404 })
    }) satisfies RegistryFetch
    const provider = new ClawHubProvider({ fetch: fetchImpl })
    const ref = { provider: "clawhub", remoteId: "awspace/pdf" }

    const skill = await provider.getDetail(ref)
    expect(skill.id).toBe("registry:clawhub:awspace/pdf")
    expect(skill.iconUrl).toBe("https://avatars.githubusercontent.com/u/1?v=4")
    expect(skill.description).toContain("# PDF Toolkit")
    expect(skill.security).toMatchObject({ status: "clean", blocked: false })

    const history = await provider.listVersions(ref)
    expect(history.map((item) => item.version)).toEqual(["0.1.0"])

    const files = await provider.listFiles({ ...ref, version: "0.1.0" })
    expect(files).toEqual([expect.objectContaining({ path: "SKILL.md", name: "SKILL.md" })])

    const file = await provider.readFile({ ...ref, version: "0.1.0", path: "SKILL.md" })
    expect(file.content).toContain("# PDF Toolkit")
    expect(file.sha256).toBe("22aed96866d0df9ab72952c467a9c62f417bc37bb572841aee30bfb306ba789a")

    const descriptor = await provider.resolveDownload({ ...ref, version: "0.1.0" })
    expect(descriptor).toMatchObject({
      kind: "archive",
      provider: "clawhub",
      remoteId: "awspace/pdf",
      version: "0.1.0",
      sha256: "4991fa905d1b4d6d2995d44812f6859297d385965b4078be001c2bfd0908017c",
    })
    expect(requested
      .filter((entry) => entry.url.pathname.includes("/skills/pdf") || entry.url.pathname === "/api/v1/download")
      .every((entry) => entry.url.searchParams.get("ownerHandle") === "awspace")).toBe(true)
  })

  test("surfaces Retry-After and observes the provider cooldown", async () => {
    let requests = 0
    let now = 1_000
    const provider = new ClawHubProvider({
      now: () => now,
      fetch: (async () => {
        requests += 1
        return new Response("Rate limit exceeded", {
          status: 429,
          headers: { "retry-after": "2", "content-type": "text/plain" },
        })
      }),
    })

    await expect(provider.search(searchInput())).rejects.toMatchObject({
      code: "RATE_LIMITED",
      retryAfterMs: 2_000,
    })
    await expect(provider.search(searchInput())).rejects.toMatchObject({ code: "RATE_LIMITED" })
    expect(requests).toBe(1)
    now += 2_001
    await expect(provider.search(searchInput())).rejects.toMatchObject({ code: "RATE_LIMITED" })
    expect(requests).toBe(2)
  })

  test("maps an aborted timeout to a source-scoped timeout error", async () => {
    const provider = new ClawHubProvider({
      timeoutMs: 5,
      fetch: ((_: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true })
      })),
    })

    await expect(provider.search(searchInput())).rejects.toMatchObject({
      provider: "clawhub",
      code: "TIMEOUT",
    })
  })

  test("does not apply latest-version moderation to a historical version", async () => {
    const provider = new ClawHubProvider({
      fetch: async () => jsonResponse({
        moderation: {
          isMalwareBlocked: true,
          isSuspicious: true,
          verdict: "malicious",
          reasonCodes: ["LATEST_MALWARE"],
          matchesRequestedVersion: false,
          sourceVersion: "2.0.0",
        },
        security: { status: "unknown" },
      }),
    })

    const security = await provider.getSecurity({
      provider: "clawhub",
      remoteId: "awspace/pdf",
      version: "0.1.0",
    })
    expect(security).toMatchObject({ status: "unknown", blocked: false })
    expect(security.reasons).not.toContain("LATEST_MALWARE")
    expect(security.reasons[0]).toContain("2.0.0")
  })

  test("rejects unsafe paths before requesting a remote file", async () => {
    let requests = 0
    const provider = new ClawHubProvider({
      fetch: async () => {
        requests += 1
        return new Response("unexpected")
      },
    })
    await expect(provider.readFile({
      provider: "clawhub",
      remoteId: "awspace/pdf",
      version: "0.1.0",
      path: "../secret",
    })).rejects.toMatchObject({ code: "INVALID_REQUEST" })
    expect(requests).toBe(0)
  })

  test("binds detail identity and requires manifest-backed file hashes", async () => {
    const detail = await fixture("clawhub-detail.json") as Record<string, any>
    const mismatched = structuredClone(detail)
    mismatched.owner.handle = "other-owner"
    const identityProvider = new ClawHubProvider({ fetch: async () => jsonResponse(mismatched) })
    await expect(identityProvider.getDetail({ provider: "clawhub", remoteId: "awspace/pdf" }))
      .rejects.toMatchObject({ code: "INVALID_RESPONSE" })

    let fileRequests = 0
    const manifestProvider = new ClawHubProvider({
      fetch: async (input) => {
        const url = new URL(input instanceof Request ? input.url : input.toString())
        if (url.pathname.endsWith("/versions/0.1.0")) {
          return jsonResponse({ version: { version: "0.1.0", files: [{ path: "SKILL.md", size: 1 }] } })
        }
        if (url.pathname.endsWith("/file")) fileRequests += 1
        return new Response("x", { headers: { "content-type": "text/plain" } })
      },
    })
    await expect(manifestProvider.readFile({
      provider: "clawhub",
      remoteId: "awspace/pdf",
      version: "0.1.0",
      path: "SKILL.md",
    })).rejects.toMatchObject({ code: "INVALID_RESPONSE" })
    expect(fileRequests).toBe(0)
  })

  test("does not turn an aborted detail scan into moderation fallback", async () => {
    const detail = await fixture("clawhub-detail.json")
    const controller = new AbortController()
    const provider = new ClawHubProvider({
      fetch: async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : input.toString())
        if (url.pathname.endsWith("/scan")) {
          return await new Promise<Response>((_resolve, reject) => {
            if (init?.signal?.aborted) {
              reject(init.signal.reason)
              return
            }
            init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true })
          })
        }
        return jsonResponse(detail)
      },
    })
    const pending = provider.getDetail({ provider: "clawhub", remoteId: "awspace/pdf" }, controller.signal)
    await Bun.sleep(0)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: "UNAVAILABLE" })
  })
})

describe("Tencent SkillHub registry provider", () => {
  test("uses the fixed public Tencent source without API keys or environment overrides", async () => {
    const payload = await fixture("skillhub-search.json")
    const previousApiUrl = process.env.SKILLHUB_API_URL
    const previousApiKey = process.env.SKILLHUB_API_KEY
    process.env.SKILLHUB_API_URL = "https://www.skillhub.club/api/v1"
    process.env.SKILLHUB_API_KEY = "must-not-be-read"
    let requested: URL | undefined
    try {
      const provider = new SkillHubProvider({
        fetch: async (input, init) => {
          requested = new URL(input instanceof Request ? input.url : input.toString())
          expect(new Headers(init?.headers).has("authorization")).toBe(false)
          return jsonResponse(payload)
        },
      })
      expect(await provider.getDescriptor()).toMatchObject({
        name: "腾讯 SkillHub",
        canonicalUrl: "https://skillhub.cn",
        beta: false,
        configured: true,
        enabled: true,
        capabilities: {
          search: true,
          detail: true,
          versions: true,
          files: true,
          download: true,
          security: true,
        },
      })
      await provider.search(searchInput())
      expect(requested?.origin).toBe("https://api.skillhub.cn")
    } finally {
      if (previousApiUrl === undefined) delete process.env.SKILLHUB_API_URL
      else process.env.SKILLHUB_API_URL = previousApiUrl
      if (previousApiKey === undefined) delete process.env.SKILLHUB_API_KEY
      else process.env.SKILLHUB_API_KEY = previousApiKey
    }
  })

  test("rejects non-HTTPS, credential-bearing, or path-bearing test API origins", () => {
    expect(() => new SkillHubProvider({ baseUrl: "http://api.skillhub.test" })).toThrow("HTTPS origin")
    expect(() => new SkillHubProvider({ baseUrl: "https://user:secret@api.skillhub.test" })).toThrow("HTTPS origin")
    expect(() => new SkillHubProvider({ baseUrl: "https://api.skillhub.test/api/v1" })).toThrow("HTTPS origin")
  })

  test("uses the official GET search contract, canonical URL, page cursor, and item-level isolation", async () => {
    const payload = await fixture("skillhub-search.json")
    let requested: URL | undefined
    let method: string | undefined
    const provider = new SkillHubProvider({
      baseUrl: "https://api.skillhub.test",
      fetch: async (input, init) => {
        requested = new URL(input instanceof Request ? input.url : input.toString())
        method = (init?.method ?? "GET").toUpperCase()
        return jsonResponse(payload)
      },
    })
    const result = await provider.search(searchInput({ query: "CAD", cursor: "2", sort: "downloads" }))

    expect(method).toBe("GET")
    expect(requested?.pathname).toBe("/api/skills")
    expect(Object.fromEntries(requested?.searchParams ?? [])).toMatchObject({
      page: "2",
      pageSize: "20",
      keyword: "CAD",
      sortBy: "downloads",
      order: "desc",
    })
    expect(result.items).toEqual([expect.objectContaining({
      id: "registry:skillhub:cad-editor",
      provider: "skillhub",
      remoteId: "cad-editor",
      displayName: "CAD Editor",
      canonicalUrl: "https://skillhub.cn/skills/cad-editor",
      version: "1.0.6",
      iconUrl: "https://cdn.skillhub.cn/icons/cad-editor.webp",
      verified: true,
      requiresApiKey: true,
    })])
    expect(result.nextCursor).toBe("3")
    expect(result.errors).toEqual([expect.objectContaining({ provider: "skillhub", code: "INVALID_RESPONSE" })])
  })

  test("reads detail, version history, files, verified file content, security reports, signature, and download", async () => {
    const [detailFixture, versionsFixture, filesFixture, signatureFixture, keysFixture] = await Promise.all([
      fixture("skillhub-detail.json"),
      fixture("skillhub-versions.json"),
      fixture("skillhub-files.json"),
      fixture("skillhub-signature.json"),
      fixture("skillhub-keys.json"),
    ])
    const skillContent = "---\nname: cad-editor\n---\n\n# CAD Editor\n"
    const requested: URL[] = []
    const provider = new SkillHubProvider({
      baseUrl: "https://api.skillhub.test",
      fetch: async (input) => {
        const url = new URL(input instanceof Request ? input.url : input.toString())
        requested.push(url)
        if (url.pathname === "/api/v1/open/platform/keys") return jsonResponse(keysFixture)
        if (url.pathname.endsWith("/signature")) return jsonResponse(signatureFixture)
        if (url.pathname.endsWith("/versions")) return jsonResponse(versionsFixture)
        if (url.pathname.endsWith("/files")) return jsonResponse(filesFixture)
        if (url.pathname.endsWith("/file")) {
          return new Response(skillContent, { headers: { "content-type": "text/markdown; charset=utf-8" } })
        }
        if (url.pathname === "/api/v1/skills/cad-editor") return jsonResponse(detailFixture)
        return new Response("not found", { status: 404 })
      },
    })
    const ref = { provider: "skillhub", remoteId: "cad-editor" }

    const detail = await provider.getDetail(ref)
    expect(detail).toMatchObject({
      id: "registry:skillhub:cad-editor",
      canonicalUrl: "https://skillhub.cn/skills/cad-editor",
      description: expect.stringContaining("# CAD Editor"),
      iconUrl: "https://cdn.skillhub.cn/icons/cad-editor.webp",
      verified: true,
      requiresApiKey: true,
      author: { handle: "user_e02e04b8", displayName: "波动几何" },
      security: { status: "clean", blocked: false },
      metadata: { verified: true, requiresApiKey: true },
    })
    expect(detail.security?.signals).toEqual(expect.arrayContaining([
      expect.objectContaining({ scanner: "keen", status: "clean" }),
      expect.objectContaining({ scanner: "sanbu", status: "clean" }),
      expect.objectContaining({ scanner: "skillhub-signature", status: "clean", summary: expect.stringContaining("Anybox verified") }),
    ]))

    const versions = await provider.listVersions(ref)
    expect(versions.map((entry) => entry.version)).toEqual(["1.0.6", "1.0.5"])
    expect(versions[1]?.security).toMatchObject({ status: "pending", blocked: false })

    const files = await provider.listFiles({ ...ref, version: "1.0.6" })
    expect(files).toEqual([expect.objectContaining({
      path: "SKILL.md",
      size: 39,
      sha256: "e13bb005009bf9fd9e3d040726b7b2fca52b73af719ebdb2c47b9b694ec9037d",
    })])
    const file = await provider.readFile({ ...ref, version: "1.0.6", path: "SKILL.md" })
    expect(file.content).toBe(skillContent)

    const security = await provider.getSecurity({ ...ref, version: "1.0.6" })
    expect(security.signals).toEqual(expect.arrayContaining([
      expect.objectContaining({ scanner: "keen" }),
      expect.objectContaining({ scanner: "sanbu" }),
      expect.objectContaining({ scanner: "skillhub-signature", status: "clean" }),
    ]))

    const descriptor = await provider.resolveDownload({ ...ref, version: "1.0.6" })
    expect(descriptor).toMatchObject({
      kind: "archive",
      provider: "skillhub",
      remoteId: "cad-editor",
      version: "1.0.6",
      url: "https://api.skillhub.test/api/v1/download?slug=cad-editor&version=1.0.6",
      contentType: "application/zip",
      contentHash: "ddd4073da7b243ccca45d5fd0de89e6d1aa2c526e9bbcc66589767f5da6dae18",
      contentHashAlgorithm: "skillhub-v1",
      integrity: {
        kind: "skillhub-ed25519-v1",
        keyId: "skillhub-platform-v1",
        publicKeyRawBase64: "Wrh8O72FAuN+qwuYh6l7+c1yKPAHjdUNNij+nb9c9Ok=",
      },
    })
    expect(requested.some((url) => url.pathname === "/api/v1/open/platform/keys")).toBe(true)
  })

  test("isolates malformed version and file entries but rejects identity and manifest ambiguity", async () => {
    const versions = await fixture("skillhub-versions.json") as Record<string, any>
    versions.versions.push({ version: 3 })
    const files = await fixture("skillhub-files.json") as Record<string, any>
    files.files.push({ path: "../unsafe", sha256: "a".repeat(64), size: 1 })
    files.count = 2
    const provider = new SkillHubProvider({
      baseUrl: "https://api.skillhub.test",
      fetch: async (input) => {
        const url = new URL(input instanceof Request ? input.url : input.toString())
        if (url.pathname.endsWith("/versions")) return jsonResponse(versions)
        if (url.pathname.endsWith("/files")) return jsonResponse(files)
        return new Response("not found", { status: 404 })
      },
    })
    expect(await provider.listVersions({ provider: "skillhub", remoteId: "cad-editor" })).toHaveLength(2)
    expect(await provider.listFiles({ provider: "skillhub", remoteId: "cad-editor", version: "1.0.6" })).toHaveLength(1)

    const mismatched = structuredClone(await fixture("skillhub-detail.json")) as Record<string, any>
    mismatched.skill.slug = "different-skill"
    const identityProvider = new SkillHubProvider({
      baseUrl: "https://api.skillhub.test",
      fetch: async () => jsonResponse(mismatched),
    })
    await expect(identityProvider.getDetail({ provider: "skillhub", remoteId: "cad-editor" }))
      .rejects.toMatchObject({ code: "INVALID_RESPONSE" })

    const duplicate = structuredClone(await fixture("skillhub-files.json")) as Record<string, any>
    duplicate.files.push(duplicate.files[0])
    duplicate.count = 2
    const duplicateProvider = new SkillHubProvider({
      baseUrl: "https://api.skillhub.test",
      fetch: async () => jsonResponse(duplicate),
    })
    await expect(duplicateProvider.listFiles({ provider: "skillhub", remoteId: "cad-editor", version: "1.0.6" }))
      .rejects.toMatchObject({ code: "INVALID_RESPONSE" })
  })

  test("rejects unsafe file paths and content that does not match the version manifest", async () => {
    let requests = 0
    const unsafe = new SkillHubProvider({
      baseUrl: "https://api.skillhub.test",
      fetch: async () => {
        requests += 1
        return new Response("unexpected")
      },
    })
    await expect(unsafe.readFile({
      provider: "skillhub",
      remoteId: "cad-editor",
      version: "1.0.6",
      path: "../secret",
    })).rejects.toMatchObject({ code: "INVALID_REQUEST" })
    expect(requests).toBe(0)

    const files = await fixture("skillhub-files.json")
    const mismatch = new SkillHubProvider({
      baseUrl: "https://api.skillhub.test",
      fetch: async (input) => {
        const url = new URL(input instanceof Request ? input.url : input.toString())
        if (url.pathname.endsWith("/files")) return jsonResponse(files)
        if (url.pathname.endsWith("/file")) {
          return new Response("tampered", { headers: { "content-type": "text/plain" } })
        }
        return new Response("not found", { status: 404 })
      },
    })
    await expect(mismatch.readFile({
      provider: "skillhub",
      remoteId: "cad-editor",
      version: "1.0.6",
      path: "SKILL.md",
    })).rejects.toMatchObject({ code: "INVALID_RESPONSE", message: expect.stringContaining("does not match") })
  })

  test("follows only the exact immutable Tencent COS file redirect", async () => {
    const files = await fixture("skillhub-files.json")
    const skillContent = "---\nname: cad-editor\n---\n\n# CAD Editor\n"
    let cosRequests = 0
    const provider = new SkillHubProvider({
      baseUrl: "https://api.skillhub.test",
      fetch: async (input) => {
        const url = new URL(input instanceof Request ? input.url : input.toString())
        if (url.pathname.endsWith("/files")) return jsonResponse(files)
        if (url.pathname.endsWith("/file")) {
          return new Response(null, {
            status: 302,
            headers: {
              location: "https://skillhub-1388575217.cos.accelerate.myqcloud.com/skills/cad-editor/1.0.6/files/SKILL.md",
              "x-content-sha256": "e13bb005009bf9fd9e3d040726b7b2fca52b73af719ebdb2c47b9b694ec9037d",
              "x-content-size": "39",
            },
          })
        }
        if (url.hostname === "skillhub-1388575217.cos.accelerate.myqcloud.com") {
          cosRequests += 1
          return new Response(skillContent, { headers: { "content-type": "text/markdown" } })
        }
        return new Response("not found", { status: 404 })
      },
    })
    expect((await provider.readFile({
      provider: "skillhub",
      remoteId: "cad-editor",
      version: "1.0.6",
      path: "SKILL.md",
    })).content).toBe(skillContent)
    expect(cosRequests).toBe(1)

    let attackerRequests = 0
    const malicious = new SkillHubProvider({
      baseUrl: "https://api.skillhub.test",
      fetch: async (input) => {
        const url = new URL(input instanceof Request ? input.url : input.toString())
        if (url.pathname.endsWith("/files")) return jsonResponse(files)
        if (url.pathname.endsWith("/file")) {
          return new Response(null, {
            status: 302,
            headers: {
              location: "https://attacker.example/skills/cad-editor/1.0.6/files/SKILL.md",
              "x-content-sha256": "e13bb005009bf9fd9e3d040726b7b2fca52b73af719ebdb2c47b9b694ec9037d",
              "x-content-size": "39",
            },
          })
        }
        attackerRequests += 1
        return new Response(skillContent)
      },
    })
    await expect(malicious.readFile({
      provider: "skillhub",
      remoteId: "cad-editor",
      version: "1.0.6",
      path: "SKILL.md",
    })).rejects.toMatchObject({ code: "INVALID_RESPONSE", message: expect.stringContaining("Tencent COS") })
    expect(attackerRequests).toBe(0)
  })

  test("rejects malformed top-level responses, non-JSON content, and oversized JSON", async () => {
    const malformed = new SkillHubProvider({
      baseUrl: "https://api.skillhub.test",
      fetch: async () => jsonResponse({ code: 0, data: { skills: "not-an-array", total: 1 }, message: "success" }),
    })
    await expect(malformed.search(searchInput())).rejects.toMatchObject({ code: "INVALID_RESPONSE" })

    const nonJson = new SkillHubProvider({
      baseUrl: "https://api.skillhub.test",
      fetch: async () => new Response("<html>checkpoint</html>", { headers: { "content-type": "text/html" } }),
    })
    await expect(nonJson.search(searchInput())).rejects.toMatchObject({ code: "INVALID_RESPONSE" })

    const oversized = new SkillHubProvider({
      baseUrl: "https://api.skillhub.test",
      fetch: async () => new Response("{}", {
        headers: { "content-type": "application/json", "content-length": String(5 * 1024 * 1024) },
      }),
    })
    await expect(oversized.search(searchInput())).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      message: expect.stringContaining("oversized JSON"),
    })
  })

  test("strictly binds and cryptographically verifies the official content signature", async () => {
    const [versions, signature, keys] = await Promise.all([
      fixture("skillhub-versions.json"),
      fixture("skillhub-signature.json"),
      fixture("skillhub-keys.json"),
    ])
    const invalidSignature = structuredClone(signature) as Record<string, any>
    const originalSignature = String(invalidSignature.signature)
    invalidSignature.signature = `${originalSignature.startsWith("A") ? "B" : "A"}${originalSignature.slice(1)}`
    const provider = new SkillHubProvider({
      baseUrl: "https://api.skillhub.test",
      fetch: async (input) => {
        const url = new URL(input instanceof Request ? input.url : input.toString())
        if (url.pathname.endsWith("/versions")) return jsonResponse(versions)
        if (url.pathname.endsWith("/signature")) return jsonResponse(invalidSignature)
        if (url.pathname.endsWith("/keys")) return jsonResponse(keys)
        return new Response("not found", { status: 404 })
      },
    })
    await expect(provider.getSecurity({ provider: "skillhub", remoteId: "cad-editor", version: "1.0.6" }))
      .rejects.toMatchObject({ code: "INVALID_RESPONSE", message: expect.stringContaining("verification failed") })
  })

  test("honors Retry-After cooldowns and maps timeouts and cancellation", async () => {
    const rateLimitPayload = await fixture("skillhub-rate-limit.json")
    let now = 1_000
    let requests = 0
    const limited = new SkillHubProvider({
      baseUrl: "https://api.skillhub.test",
      now: () => now,
      fetch: async () => {
        requests += 1
        return jsonResponse(rateLimitPayload, { status: 429, headers: { "retry-after": "2" } })
      },
    })
    await expect(limited.search(searchInput())).rejects.toMatchObject({ code: "RATE_LIMITED", retryAfterMs: 2_000 })
    await expect(limited.search(searchInput())).rejects.toMatchObject({ code: "RATE_LIMITED" })
    expect(requests).toBe(1)
    now += 2_001
    await expect(limited.search(searchInput())).rejects.toMatchObject({ code: "RATE_LIMITED" })
    expect(requests).toBe(2)

    const timedOut = new SkillHubProvider({
      baseUrl: "https://api.skillhub.test",
      timeoutMs: 5,
      fetch: (_input, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true })
      }),
    })
    await expect(timedOut.search(searchInput())).rejects.toMatchObject({ provider: "skillhub", code: "TIMEOUT" })

    const controller = new AbortController()
    const cancelled = new SkillHubProvider({
      baseUrl: "https://api.skillhub.test",
      fetch: (_input, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true })
      }),
    })
    const pending = cancelled.search(searchInput(), controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ provider: "skillhub", code: "UNAVAILABLE" })
  })
})

function descriptor(id: string): RegistryProviderDescriptor {
  return {
    id,
    name: id,
    description: id,
    canonicalUrl: `https://${id}.example.com`,
    beta: false,
    enabled: true,
    configured: true,
    capabilities: {
      search: true,
      browse: true,
      detail: true,
      versions: true,
      files: true,
      download: true,
      security: true,
    },
  }
}

function fakeProvider(id: string, search: SkillRegistryProvider["search"]): SkillRegistryProvider {
  return {
    id,
    capabilities: descriptor(id).capabilities,
    getDescriptor: async () => descriptor(id),
    search,
    getDetail: async () => { throw new Error("unused") },
    listVersions: async () => { throw new Error("unused") },
    listFiles: async () => { throw new Error("unused") },
    readFile: async () => { throw new Error("unused") },
    resolveDownload: async () => { throw new Error("unused") },
    getSecurity: async () => { throw new Error("unused") },
  }
}

describe("skill registry catalog and routes", () => {
  test("returns valid provider results alongside source-level failures", async () => {
    const root = await mkdtemp(join(tmpdir(), "anybox-registry-cache-"))
    temporaryDirectories.push(root)
    const item: RegistrySkillSummary = {
      id: "registry:healthy:owner/demo",
      provider: "healthy",
      remoteId: "owner/demo",
      slug: "demo",
      displayName: "Demo",
      summary: "Works",
      author: { handle: "owner" },
      canonicalUrl: "https://healthy.example.com/owner/demo",
      topics: [],
    }
    const healthy = fakeProvider("healthy", async () => ({ items: [item] }))
    const failing = fakeProvider("failing", async () => {
      throw new RegistryProviderRequestError("failing", "RATE_LIMITED", "Slow down", 5_000, 429)
    })
    const catalog = new SkillRegistryCatalog({ providers: [healthy, failing], cacheRoot: root })

    const result = await catalog.search({
      query: "demo",
      providers: ["healthy", "failing"],
      limit: 20,
      sort: "relevance",
      safeOnly: true,
    })
    expect(result.items).toEqual([expect.objectContaining({ id: item.id, score: 1 })])
    expect(result.errors).toEqual([expect.objectContaining({
      provider: "failing",
      code: "RATE_LIMITED",
      retryAfterMs: 5_000,
    })])
    const app = new Hono<AppEnv>()
    app.use("*", async (c, next) => {
      c.set("requestId", "req_registry")
      await next()
    })
    app.route("/api/skill-registry", SkillRegistryRoutes({ catalog }))
    const response = await app.request("/api/skill-registry/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "demo", providers: ["healthy", "failing"] }),
    })
    expect(response.status).toBe(200)
    const body = await response.json() as { data: { items: RegistrySkillSummary[]; errors: Array<{ provider: string }> } }
    expect(body.data.items[0]?.id).toBe(item.id)
    expect(body.data.errors[0]?.provider).toBe("failing")
  })

  test("stores terminal partial responses only with the short TTL", async () => {
    const root = await mkdtemp(join(tmpdir(), "anybox-registry-partial-"))
    temporaryDirectories.push(root)
    const item: RegistrySkillSummary = {
      id: "registry:partial:owner/demo",
      provider: "partial",
      remoteId: "owner/demo",
      slug: "demo",
      displayName: "Demo",
      summary: "",
      author: { handle: "owner" },
      canonicalUrl: "https://partial.example.com/demo",
      topics: [],
    }
    const catalog = new SkillRegistryCatalog({
      providers: [fakeProvider("partial", async () => ({
        items: [item],
        errors: [{ provider: "partial", code: "INVALID_RESPONSE", message: "one malformed item" }],
      }))],
      cacheRoot: root,
    })
    await catalog.search({ query: "", limit: 20, sort: "relevance", safeOnly: true })
    const cacheFiles = await readdir(join(root, "skill-registry", "search"))
    const cacheRecord = JSON.parse(await readFile(join(root, "skill-registry", "search", cacheFiles[0]!), "utf8")) as {
      createdAt: number
      expiresAt: number
    }
    expect(cacheRecord.expiresAt - cacheRecord.createdAt).toBe(30_000)
  })

  test("deduplicates requested providers and reuses persistent search cache across catalog instances", async () => {
    const root = await mkdtemp(join(tmpdir(), "anybox-registry-cache-"))
    temporaryDirectories.push(root)
    const item: RegistrySkillSummary = {
      id: "registry:cache:owner/demo",
      provider: "cache",
      remoteId: "owner/demo",
      slug: "demo",
      displayName: "Cached Demo",
      summary: "Cached",
      author: { handle: "owner" },
      canonicalUrl: "https://cache.example.com/owner/demo",
      topics: [],
    }
    let requests = 0
    const first = new SkillRegistryCatalog({
      providers: [fakeProvider("cache", async () => {
        requests += 1
        return { items: [item] }
      })],
      cacheRoot: root,
    })
    const input = {
      query: "demo",
      providers: ["cache", "cache"],
      limit: 20,
      sort: "relevance" as const,
      safeOnly: true,
    }
    expect((await first.search(input)).items).toHaveLength(1)
    expect(requests).toBe(1)

    const second = new SkillRegistryCatalog({
      providers: [fakeProvider("cache", async () => {
        requests += 1
        throw new Error("disk cache should avoid this request")
      })],
      cacheRoot: root,
    })
    expect((await second.search(input)).items).toEqual([expect.objectContaining({ id: item.id })])
    expect(requests).toBe(1)
  })

  test("keeps sliced provider results in an opaque aggregate cursor", async () => {
    const root = await mkdtemp(join(tmpdir(), "anybox-registry-pages-"))
    temporaryDirectories.push(root)
    const calls = new Map<string, number>()
    const provider = (id: string) => fakeProvider(id, async () => {
      calls.set(id, (calls.get(id) ?? 0) + 1)
      return {
        items: [1, 2].map((rank): RegistrySkillSummary => ({
          id: `registry:${id}:owner/${id}-${rank}`,
          provider: id,
          remoteId: `owner/${id}-${rank}`,
          slug: `${id}-${rank}`,
          displayName: `${id.toUpperCase()} ${rank}`,
          summary: "",
          author: { handle: "owner" },
          canonicalUrl: `https://${id}.example.com/${rank}`,
          topics: [],
        })),
      }
    })
    const catalog = new SkillRegistryCatalog({ providers: [provider("alpha"), provider("beta")], cacheRoot: root })
    const input = {
      query: "demo",
      providers: ["alpha", "beta"],
      limit: 2,
      sort: "relevance" as const,
      safeOnly: true,
    }
    const first = await catalog.search(input)
    expect(first.items.map((item) => item.remoteId)).toEqual(["owner/alpha-1", "owner/beta-1"])
    expect(first.nextCursor).toEqual({ $anybox: expect.any(String) })
    const second = await catalog.search({ ...input, cursor: first.nextCursor })
    expect(second.items.map((item) => item.remoteId)).toEqual(["owner/alpha-2", "owner/beta-2"])
    expect(second.nextCursor).toBeUndefined()
    expect(calls).toEqual(new Map([["alpha", 1], ["beta", 1]]))
  })

  test("isolates descriptor failures and invalidates provider caches", async () => {
    const root = await mkdtemp(join(tmpdir(), "anybox-registry-invalidate-"))
    temporaryDirectories.push(root)
    let searches = 0
    let invalidations = 0
    const item: RegistrySkillSummary = {
      id: "registry:healthy:owner/demo",
      provider: "healthy",
      remoteId: "owner/demo",
      slug: "demo",
      displayName: "Demo",
      summary: "",
      author: { handle: "owner" },
      canonicalUrl: "https://healthy.example.com/demo",
      topics: [],
    }
    const healthy = fakeProvider("healthy", async () => {
      searches += 1
      return { items: [item] }
    })
    healthy.invalidateCache = async () => { invalidations += 1 }
    const broken = fakeProvider("broken", async () => ({ items: [] }))
    broken.getDescriptor = async () => {
      throw new RegistryProviderRequestError("broken", "UNAVAILABLE", "descriptor failed")
    }
    const catalog = new SkillRegistryCatalog({ providers: [healthy, broken], cacheRoot: root })
    expect((await catalog.listProviders()).map((provider) => provider.id)).toEqual(["healthy"])
    const first = await catalog.search({ query: "", limit: 20, sort: "relevance", safeOnly: true })
    expect(first.items).toHaveLength(1)
    expect(first.errors).toContainEqual(expect.objectContaining({ provider: "broken", code: "UNAVAILABLE" }))
    const healthyInput = { query: "", providers: ["healthy"], limit: 20, sort: "relevance" as const, safeOnly: true }
    await catalog.search(healthyInput)
    await catalog.search(healthyInput)
    expect(searches).toBe(2)
    await catalog.invalidateProvider("healthy")
    expect(invalidations).toBe(1)
    await catalog.search(healthyInput)
    expect(searches).toBe(3)
  })

  test("does not serve stale cache on abort and keeps signal-bound loads independent", async () => {
    const root = await mkdtemp(join(tmpdir(), "anybox-registry-abort-"))
    temporaryDirectories.push(root)
    let now = 1
    const cache = new RegistryPersistentCache("abort-test", z.string(), 1, { root, now: () => now })
    await cache.set("stale", "old")
    now = 3
    const aborted = new AbortController()
    aborted.abort()
    await expect(cache.getOrLoad("stale", async () => {
      throw new Error("cancelled")
    }, { staleIfError: true, signal: aborted.signal })).rejects.toThrow("cancelled")

    let loads = 0
    const firstController = new AbortController()
    const secondController = new AbortController()
    const first = cache.getOrLoad("parallel", async () => {
      loads += 1
      return await new Promise<string>((_resolve, reject) => {
        if (firstController.signal.aborted) {
          reject(new Error("first cancelled"))
          return
        }
        firstController.signal.addEventListener("abort", () => reject(new Error("first cancelled")), { once: true })
      })
    }, { signal: firstController.signal })
    const second = cache.getOrLoad("parallel", async () => {
      loads += 1
      return "second"
    }, { signal: secondController.signal })
    firstController.abort()
    await expect(first).rejects.toThrow("first cancelled")
    expect(await second).toBe("second")
    expect(loads).toBe(2)
  })

  test("treats cache writes as best-effort", async () => {
    const root = await mkdtemp(join(tmpdir(), "anybox-registry-write-"))
    temporaryDirectories.push(root)
    const item: RegistrySkillSummary = {
      id: "registry:cache-write:owner/demo",
      provider: "cache-write",
      remoteId: "owner/demo",
      slug: "demo",
      displayName: "Demo",
      summary: "",
      author: { handle: "owner" },
      canonicalUrl: "https://cache-write.example.com/demo",
      topics: [],
    }
    const catalog = new SkillRegistryCatalog({
      providers: [fakeProvider("cache-write", async () => ({ items: [item] }))],
      cacheRoot: root,
    })
    const searchDisk = (catalog as unknown as { searchDisk: { set: () => Promise<never> } }).searchDisk
    searchDisk.set = async () => { throw new Error("disk full") }
    expect((await catalog.search({ query: "", limit: 20, sort: "relevance", safeOnly: true })).items).toHaveLength(1)
  })

  test("uses manifest SHA in immutable file-content cache keys", async () => {
    const root = await mkdtemp(join(tmpdir(), "anybox-registry-file-key-"))
    temporaryDirectories.push(root)
    const sha256 = "a".repeat(64)
    const provider = fakeProvider("files", async () => ({ items: [] }))
    provider.listFiles = async (input) => [{
      provider: "files",
      remoteId: input.remoteId,
      version: input.version,
      path: "SKILL.md",
      name: "SKILL.md",
      sha256,
    }]
    provider.readFile = async (input) => ({
      provider: "files",
      remoteId: input.remoteId,
      version: input.version,
      path: input.path,
      name: "SKILL.md",
      sha256,
      content: "# Demo",
      encoding: "utf8",
    })
    const catalog = new SkillRegistryCatalog({ providers: [provider], cacheRoot: root })
    let capturedKey = ""
    let capturedTtl = 0
    const fileDisk = (catalog as unknown as {
      fileDisk: {
        getOrLoad: (
          key: string,
          load: () => Promise<RegistryFileContent>,
          options: { ttlMs?: number },
        ) => Promise<RegistryFileContent>
      }
    }).fileDisk
    fileDisk.getOrLoad = async (key, load, options) => {
      capturedKey = key
      capturedTtl = options.ttlMs ?? 0
      return await load()
    }
    await catalog.readFile({ provider: "files", remoteId: "owner/demo", version: "1.0.0", path: "SKILL.md" })
    expect(capturedKey).toContain(sha256)
    expect(capturedTtl).toBe(365 * 24 * 60 * 60 * 1000)
  })

  test("compares version-pinned file hashes without downloading target content", () => {
    const base = { provider: "clawhub", remoteId: "owner/demo" }
    const changes = compareRegistryFiles(
      [
        { ...base, version: "1.0.0", path: "SKILL.md", name: "SKILL.md", sha256: "a".repeat(64), size: 10 },
        { ...base, version: "1.0.0", path: "removed.md", name: "removed.md", sha256: "b".repeat(64), size: 20 },
        { ...base, version: "1.0.0", path: "same.md", name: "same.md", sha256: "c".repeat(64), size: 30 },
      ],
      [
        { ...base, version: "2.0.0", path: "SKILL.md", name: "SKILL.md", sha256: "d".repeat(64), size: 11 },
        { ...base, version: "2.0.0", path: "added.md", name: "added.md", sha256: "e".repeat(64), size: 40 },
        { ...base, version: "2.0.0", path: "same.md", name: "same.md", sha256: "c".repeat(64), size: 30 },
      ],
    )
    expect(changes).toEqual([
      expect.objectContaining({ path: "added.md", status: "added", targetSha256: "e".repeat(64) }),
      expect.objectContaining({ path: "removed.md", status: "removed", currentSha256: "b".repeat(64) }),
      expect.objectContaining({ path: "SKILL.md", status: "changed", currentSha256: "a".repeat(64), targetSha256: "d".repeat(64) }),
    ])
    expect(compareRegistryFiles([], [{ ...base, path: "SKILL.md", name: "SKILL.md" }])).toBeUndefined()
  })

  test("maps managed integrity and infrastructure failures to stable HTTP classes", () => {
    for (const code of [
      "HASH_MISMATCH", "INVALID_SIGNATURE", "INVALID_HANDOFF", "INVALID_GITHUB_HANDOFF", "INVALID_ARCHIVE",
      "INVALID_PACKAGE", "INVALID_REDIRECT", "TOO_MANY_REDIRECTS", "UNSAFE_HOST",
    ]) expect(managedErrorStatus(code)).toBe(502)
    for (const code of ["PACKAGE_CONFLICT", "VERSION_IMMUTABILITY_VIOLATION", "PACKAGE_TAMPERED"]) {
      expect(managedErrorStatus(code)).toBe(409)
    }
    for (const code of ["STORE_CORRUPT", "FORK_FAILED"]) expect(managedErrorStatus(code)).toBe(500)
  })
})
