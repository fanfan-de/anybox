import assert from "node:assert/strict"
import test from "node:test"
import { VerifiedArtifactCache } from "./cache.js"

test("verified cache evicts old runtime keys instead of growing without a bound", () => {
  let now = 1_000
  const cache = new VerifiedArtifactCache<string>(60, 1_000, () => now, 2)

  cache.set("0.3.0:preview", "first")
  now += 1
  cache.set("0.3.0:production", "second")
  now += 1
  cache.set("attacker-controlled-runtime", "third")

  assert.equal(cache.getStale("0.3.0:preview"), undefined)
  assert.equal(cache.getStale("0.3.0:production"), "second")
  assert.equal(cache.getStale("attacker-controlled-runtime"), "third")
})

test("verified cache removes entries after the stale fallback window", () => {
  let now = 1_000
  const cache = new VerifiedArtifactCache<string>(60, 1_000, () => now, 2)
  cache.set("old", "old-value")
  now += 1_001
  cache.set("new", "new-value")

  assert.equal(cache.getStale("old"), undefined)
  assert.equal(cache.getFresh("new"), "new-value")
})
