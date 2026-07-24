import assert from "node:assert/strict"
import { generateKeyPairSync, randomUUID, sign } from "node:crypto"
import test from "node:test"
import { createUpdateApp } from "./app.js"
import type { ExpoUpdateManifest, MobileOtaChannelPointer } from "./types.js"

const cdnBaseUrl = "https://download.anybox.com.cn"
const runtimeVersion = "0.3.0"
const createdAt = "2026-07-25T00:00:00.000Z"
const nativeFingerprint = "A".repeat(43)
const sourceCommit = "a".repeat(40)

function signingKeys() {
  return generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  })
}

function signatureFor(body: string, privateKey: string) {
  return sign("RSA-SHA256", Buffer.from(body), privateKey).toString("base64")
}

function updateFixture(privateKey: string) {
  const updateId = randomUUID()
  const releaseBase = `${cdnBaseUrl}/mobile/ota/releases/${runtimeVersion}/${updateId}`
  const manifest: ExpoUpdateManifest = {
    id: updateId,
    createdAt,
    runtimeVersion,
    launchAsset: {
      hash: "B".repeat(43),
      key: "launch",
      contentType: "application/javascript",
      url: `${releaseBase}/assets/${"b".repeat(64)}.bundle`,
    },
    assets: [
      {
        hash: "C".repeat(43),
        key: "image",
        contentType: "image/png",
        fileExtension: ".png",
        url: `${releaseBase}/assets/${"c".repeat(64)}.png`,
      },
    ],
    metadata: {},
    extra: {
      anybox: {
        channel: "preview",
        message: "Test update",
        nativeFingerprint,
        sourceCommit,
      },
    },
  }
  const rawBody = JSON.stringify(manifest)
  const pointer: MobileOtaChannelPointer = {
    schemaVersion: 1,
    type: "update",
    channel: "preview",
    platform: "android",
    runtimeVersion,
    updateId,
    createdAt,
    manifestUrl: `${releaseBase}/manifest.json`,
    signature: signatureFor(rawBody, privateKey),
    keyId: "anybox-mobile-2026",
    sourceCommit,
    message: "Test update",
    nativeFingerprint,
  }
  return { updateId, rawBody, pointer }
}

function rollbackFixture(privateKey: string) {
  const updateId = randomUUID()
  const rawBody = JSON.stringify({
    type: "rollBackToEmbedded",
    parameters: { commitTime: createdAt },
  })
  const pointer: MobileOtaChannelPointer = {
    schemaVersion: 1,
    type: "rollback",
    channel: "production",
    platform: "android",
    runtimeVersion,
    updateId,
    createdAt,
    manifestUrl: `${cdnBaseUrl}/mobile/ota/releases/${runtimeVersion}/${updateId}/manifest.json`,
    signature: signatureFor(rawBody, privateKey),
    keyId: "anybox-mobile-2026",
    sourceCommit,
    message: "Emergency rollback",
    nativeFingerprint,
  }
  return { updateId, rawBody, pointer }
}

function fakeFetch(pointer: MobileOtaChannelPointer, rawBody: string): typeof fetch {
  return async (input) => {
    const url = String(input)
    if (url.includes("/mobile/ota/channels/")) {
      return new Response(JSON.stringify(pointer), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }
    if (url === pointer.manifestUrl) {
      return new Response(rawBody, {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }
    return new Response("missing", { status: 404 })
  }
}

function requestHeaders(channel = "preview") {
  return {
    accept: "application/expo+json, application/json, multipart/mixed",
    "expo-protocol-version": "1",
    "expo-platform": "android",
    "expo-runtime-version": runtimeVersion,
    "expo-channel-name": channel,
    "expo-expect-signature": 'sig, keyid="anybox-mobile-2026", alg="rsa-v1_5-sha256"',
  }
}

test("serves a verified update with protocol and signature headers", async () => {
  const keys = signingKeys()
  const fixture = updateFixture(keys.privateKey)
  const app = createUpdateApp({
    cdnBaseUrl,
    publicKeyPem: keys.publicKey,
    fetcher: fakeFetch(fixture.pointer, fixture.rawBody),
    logger: () => undefined,
  })

  const response = await app.request("/v1/manifest", { headers: requestHeaders() })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("content-type"), "application/expo+json; charset=utf-8")
  assert.equal(response.headers.get("expo-protocol-version"), "1")
  assert.match(response.headers.get("expo-signature") ?? "", /keyid="anybox-mobile-2026"/)
  assert.equal(await response.text(), fixture.rawBody)
})

test("returns 204 when the current update id is already newest", async () => {
  const keys = signingKeys()
  const fixture = updateFixture(keys.privateKey)
  const app = createUpdateApp({
    cdnBaseUrl,
    publicKeyPem: keys.publicKey,
    fetcher: fakeFetch(fixture.pointer, fixture.rawBody),
    logger: () => undefined,
  })
  const response = await app.request("/v1/manifest", {
    headers: {
      ...requestHeaders(),
      "expo-current-update-id": fixture.updateId,
    },
  })
  assert.equal(response.status, 204)
  assert.equal(await response.text(), "")
})

test("returns 204 when the CDN has no pointer for the requested runtime", async () => {
  const keys = signingKeys()
  const app = createUpdateApp({
    cdnBaseUrl,
    publicKeyPem: keys.publicKey,
    fetcher: async () => new Response("missing", { status: 404 }),
    logger: () => undefined,
  })
  const response = await app.request("/v1/manifest", { headers: requestHeaders() })
  assert.equal(response.status, 204)
})

test("returns a signed multipart rollback directive", async () => {
  const keys = signingKeys()
  const fixture = rollbackFixture(keys.privateKey)
  const app = createUpdateApp({
    cdnBaseUrl,
    publicKeyPem: keys.publicKey,
    fetcher: fakeFetch(fixture.pointer, fixture.rawBody),
    logger: () => undefined,
  })
  const response = await app.request("/v1/manifest", {
    headers: {
      ...requestHeaders("production"),
      "expo-current-update-id": randomUUID(),
      "expo-embedded-update-id": randomUUID(),
    },
  })
  assert.equal(response.status, 200)
  assert.match(response.headers.get("content-type") ?? "", /^multipart\/mixed; boundary=/)
  const body = await response.text()
  assert.match(body, /name="directive"/)
  assert.match(body, /expo-signature: sig="/)
  assert.match(body, /rollBackToEmbedded/)
})

test("rejects missing and invalid protocol headers with 400", async () => {
  const keys = signingKeys()
  const fixture = updateFixture(keys.privateKey)
  const app = createUpdateApp({
    cdnBaseUrl,
    publicKeyPem: keys.publicKey,
    fetcher: fakeFetch(fixture.pointer, fixture.rawBody),
    logger: () => undefined,
  })
  const response = await app.request("/v1/manifest", {
    headers: { ...requestHeaders(), "expo-protocol-version": "0" },
  })
  assert.equal(response.status, 400)
})

test("rejects a body signed by the wrong private key", async () => {
  const trusted = signingKeys()
  const attacker = signingKeys()
  const fixture = updateFixture(attacker.privateKey)
  const app = createUpdateApp({
    cdnBaseUrl,
    publicKeyPem: trusted.publicKey,
    fetcher: fakeFetch(fixture.pointer, fixture.rawBody),
    logger: () => undefined,
  })
  const response = await app.request("/v1/manifest", { headers: requestHeaders() })
  assert.equal(response.status, 503)
  assert.equal((await response.json() as { reason: string }).reason, "invalid_signed_artifact")
})

test("rejects HTTP, foreign-host and path-traversal artifact URLs", async (t) => {
  const keys = signingKeys()
  for (const manifestUrl of [
    "http://download.anybox.com.cn/mobile/ota/releases/0.3.0/id/manifest.json",
    "https://evil.example/mobile/ota/releases/0.3.0/id/manifest.json",
    "https://download.anybox.com.cn/mobile/ota/releases/0.3.0/../manifest.json",
  ]) {
    await t.test(manifestUrl, async () => {
      const fixture = updateFixture(keys.privateKey)
      const pointer = { ...fixture.pointer, manifestUrl }
      const app = createUpdateApp({
        cdnBaseUrl,
        publicKeyPem: keys.publicKey,
        fetcher: fakeFetch(pointer, fixture.rawBody),
        logger: () => undefined,
      })
      const response = await app.request("/v1/manifest", { headers: requestHeaders() })
      assert.equal(response.status, 503)
    })
  }
})

test("rejects a CDN metadata redirect that downgrades to HTTP", async () => {
  const keys = signingKeys()
  const fixture = updateFixture(keys.privateKey)
  const fetcher: typeof fetch = async (input) => {
    const url = String(input)
    const response = url.includes("/mobile/ota/channels/")
      ? new Response(JSON.stringify(fixture.pointer), { status: 200 })
      : new Response(fixture.rawBody, { status: 200 })
    Object.defineProperty(response, "url", {
      configurable: true,
      value: url.replace("https://", "http://"),
    })
    return response
  }
  const app = createUpdateApp({
    cdnBaseUrl,
    publicKeyPem: keys.publicKey,
    fetcher,
    logger: () => undefined,
  })
  const response = await app.request("/v1/manifest", { headers: requestHeaders() })
  assert.equal(response.status, 503)
  assert.equal((await response.json() as { reason: string }).reason, "invalid_signed_artifact")
})

test("rejects a signed manifest whose asset hash or URL is unsafe", async (t) => {
  const keys = signingKeys()
  for (const mutation of [
    (manifest: ExpoUpdateManifest) => {
      manifest.launchAsset.url = "https://evil.example/payload.bundle"
    },
    (manifest: ExpoUpdateManifest) => {
      manifest.launchAsset.hash = "not-a-sha256"
    },
  ]) {
    await t.test(mutation.name || "unsafe asset", async () => {
      const fixture = updateFixture(keys.privateKey)
      const manifest = JSON.parse(fixture.rawBody) as ExpoUpdateManifest
      mutation(manifest)
      const rawBody = JSON.stringify(manifest)
      const pointer = {
        ...fixture.pointer,
        signature: signatureFor(rawBody, keys.privateKey),
      }
      const app = createUpdateApp({
        cdnBaseUrl,
        publicKeyPem: keys.publicKey,
        fetcher: fakeFetch(pointer, rawBody),
        logger: () => undefined,
      })
      const response = await app.request("/v1/manifest", { headers: requestHeaders() })
      assert.equal(response.status, 503)
      assert.equal((await response.json() as { reason: string }).reason, "invalid_signed_artifact")
    })
  }
})

test("returns 503 when the CDN is unavailable and there is no verified cache", async () => {
  const keys = signingKeys()
  const app = createUpdateApp({
    cdnBaseUrl,
    publicKeyPem: keys.publicKey,
    fetcher: async () => {
      throw new TypeError("offline")
    },
    logger: () => undefined,
  })
  const response = await app.request("/v1/manifest", { headers: requestHeaders() })
  assert.equal(response.status, 503)
})

test("uses a previously verified artifact for up to 24 hours on CDN failure", async () => {
  const keys = signingKeys()
  const fixture = updateFixture(keys.privateKey)
  let online = true
  let clock = 1_000
  const fetcher: typeof fetch = async (...args) => {
    if (!online) throw new TypeError("offline")
    return fakeFetch(fixture.pointer, fixture.rawBody)(...args)
  }
  const app = createUpdateApp({
    cdnBaseUrl,
    publicKeyPem: keys.publicKey,
    fetcher,
    now: () => clock,
    freshCacheMs: 60_000,
    staleCacheMs: 24 * 60 * 60 * 1000,
    logger: () => undefined,
  })
  assert.equal((await app.request("/v1/manifest", { headers: requestHeaders() })).status, 200)
  online = false
  clock += 61_000
  assert.equal((await app.request("/v1/manifest", { headers: requestHeaders() })).status, 200)
  clock += 24 * 60 * 60 * 1000
  assert.equal((await app.request("/v1/manifest", { headers: requestHeaders() })).status, 503)
})

test("health and anonymous metrics endpoints expose no request identity", async () => {
  const keys = signingKeys()
  const app = createUpdateApp({
    cdnBaseUrl,
    publicKeyPem: keys.publicKey,
    fetcher: async (_input, init) => {
      assert.equal(init?.method, "HEAD")
      return new Response(null, { status: 200 })
    },
    logger: () => undefined,
  })

  assert.equal((await app.request("/livez")).status, 200)
  assert.equal((await app.request("/readyz")).status, 200)
  await app.request("/v1/manifest", {
    headers: {
      ...requestHeaders(),
      "expo-protocol-version": "invalid",
      "x-device-id": "private-device-id",
      "x-forwarded-for": "203.0.113.10",
    },
  })
  const response = await app.request("/metrics")
  const metrics = await response.text()
  assert.equal(response.status, 200)
  assert.match(metrics, /channel="invalid",result="invalid"} 1/)
  assert.doesNotMatch(metrics, /private-device-id|203\.0\.113\.10|0\.3\.0/)
})
