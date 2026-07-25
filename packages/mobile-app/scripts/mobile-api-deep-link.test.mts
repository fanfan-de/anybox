import assert from "node:assert/strict"
import test from "node:test"
import {
  readBridgeUrlFromConnectDeepLink,
  readConnectionOptionsFromDeepLink,
  readConnectionUrlFromDeepLink,
  readRelayPairingFromDeepLink,
} from "../src/api/mobile-api"

for (const scheme of ["anybox-mobile", "anybox-mobile-dev"]) {
  test(`${scheme} connect deep links are accepted`, () => {
    const bridgeUrl = "http://192.168.1.20:9866/?token=test"
    const deepLink = `${scheme}://connect?url=${encodeURIComponent(bridgeUrl)}`
    assert.equal(readBridgeUrlFromConnectDeepLink(deepLink), bridgeUrl)
    assert.equal(readConnectionUrlFromDeepLink(deepLink), bridgeUrl)
  })

  test(`${scheme} relay pairing and connection-options deep links are accepted`, () => {
    const relay = readRelayPairingFromDeepLink(
      `${scheme}://pair?code=pair-code&url=${encodeURIComponent("https://anybox.com.cn")}`,
    )
    assert.deepEqual(relay, {
      baseUrl: "https://anybox.com.cn",
      code: "pair-code",
    })

    const optionsLink =
      `${scheme}://connect-options?` +
      new URLSearchParams({
        relay: `${scheme}://pair?code=pair-code`,
        lan: "http://192.168.1.20:9866/?token=test",
      })
    assert.deepEqual(readConnectionOptionsFromDeepLink(optionsLink), [
      { kind: "relay", endpoint: `${scheme}://pair?code=pair-code` },
      { kind: "lan", endpoint: "http://192.168.1.20:9866/?token=test" },
    ])
    assert.equal(readConnectionUrlFromDeepLink(optionsLink), optionsLink)
  })
}

test("unrelated URL schemes remain rejected", () => {
  assert.equal(
    readBridgeUrlFromConnectDeepLink(
      "https://connect?url=http%3A%2F%2F127.0.0.1%3A9866",
    ),
    null,
  )
  assert.equal(readRelayPairingFromDeepLink("example://pair?code=test"), null)
  assert.equal(
    readConnectionOptionsFromDeepLink("example://connect-options?lan=http://localhost"),
    null,
  )
})
