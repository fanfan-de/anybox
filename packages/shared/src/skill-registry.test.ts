import { describe, expect, test } from "vitest"
import {
  DownloadedRegistrySkillIconUrlSchema,
  RegistryDownloadDescriptorSchema,
  RegistryRelativePathSchema,
  RegistrySearchInputSchema,
  RegistrySkillSummarySchema,
} from "./skill-registry"

describe("skill registry contracts", () => {
  test("applies stable search defaults", () => {
    expect(RegistrySearchInputSchema.parse({})).toEqual({
      query: "",
      limit: 20,
      sort: "relevance",
      safeOnly: true,
    })
  })

  test("rejects unsafe externally-opened URL schemes", () => {
    const result = RegistrySkillSummarySchema.safeParse({
      id: "registry:test:owner/demo",
      provider: "test",
      remoteId: "owner/demo",
      slug: "demo",
      displayName: "Demo",
      summary: "",
      author: { handle: "owner" },
      canonicalUrl: "javascript:alert(1)",
      topics: [],
    })
    expect(result.success).toBe(false)
  })

  test("accepts HTTPS product metadata and rejects unsafe remote icon URLs", () => {
    const item = {
      id: "registry:test:owner/demo",
      provider: "test",
      remoteId: "owner/demo",
      slug: "demo",
      displayName: "Demo",
      summary: "A productized skill",
      iconUrl: "https://cdn.example.com/icons/demo.webp",
      verified: true,
      requiresApiKey: true,
      author: { handle: "owner" },
      canonicalUrl: "https://example.com/owner/demo",
      topics: [],
    }

    expect(RegistrySkillSummarySchema.parse(item)).toMatchObject({
      iconUrl: item.iconUrl,
      verified: true,
      requiresApiKey: true,
    })
    expect(RegistrySkillSummarySchema.safeParse({ ...item, iconUrl: "http://cdn.example.com/demo.png" }).success)
      .toBe(false)
  })

  test("allows only inert base64 raster data URLs for downloaded skill icons", () => {
    expect(DownloadedRegistrySkillIconUrlSchema.parse("data:image/png;base64,aWNvbg=="))
      .toBe("data:image/png;base64,aWNvbg==")
    for (const unsafe of [
      "https://cdn.example.com/icon.png",
      "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
      "data:text/html;base64,PGgxPmhpPC9oMT4=",
      "data:image/png,not-base64",
    ]) expect(DownloadedRegistrySkillIconUrlSchema.safeParse(unsafe).success).toBe(false)
  })

  test("accepts only safe relative POSIX registry file paths", () => {
    expect(RegistryRelativePathSchema.parse("scripts/run.ts")).toBe("scripts/run.ts")
    for (const unsafe of ["../secret", "/absolute", "C:/secret", "a\\b", "%2e%2e/secret", "a//b"]) {
      expect(RegistryRelativePathSchema.safeParse(unsafe).success).toBe(false)
    }
  })

  test("accepts Tencent SkillHub signed archive integrity as one complete proof", () => {
    const descriptor = RegistryDownloadDescriptorSchema.parse({
      kind: "archive",
      provider: "skillhub",
      remoteId: "demo-skill",
      version: "1.0.0",
      url: "https://api.skillhub.cn/api/v1/download?slug=demo-skill&version=1.0.0",
      contentHash: "a".repeat(64),
      contentHashAlgorithm: "skillhub-v1",
      integrity: {
        kind: "skillhub-ed25519-v1",
        keyId: "skillhub-ed25519-2025-01",
        publicKeyRawBase64: "A".repeat(43) + "=",
        payload: '{"v":1,"issuer":"skillhub.cn"}',
        signatureBase64: "B".repeat(86) + "==",
      },
    })

    expect(descriptor.kind).toBe("archive")
    if (descriptor.kind === "archive") {
      expect(descriptor.contentHashAlgorithm).toBe("skillhub-v1")
      expect(descriptor.integrity?.kind).toBe("skillhub-ed25519-v1")
    }
  })

  test("rejects an unauthenticated Tencent SkillHub content hash", () => {
    const result = RegistryDownloadDescriptorSchema.safeParse({
      kind: "archive",
      provider: "skillhub",
      remoteId: "demo-skill",
      version: "1.0.0",
      url: "https://api.skillhub.cn/api/v1/download?slug=demo-skill&version=1.0.0",
      contentHash: "a".repeat(64),
      contentHashAlgorithm: "skillhub-v1",
    })

    expect(result.success).toBe(false)
  })
})
