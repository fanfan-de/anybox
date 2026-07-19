import { expect, test } from "bun:test"
import { BrowserExtensionServerMessage } from "@anybox/chrome-shared/browser-extension"
import {
  supportsBrowserCommandContractVersion,
} from "../src/background/browser-contract-compat"

test("accepts a legacy Browser Host command envelope while rejecting an explicit future contract", () => {
  const legacy = BrowserExtensionServerMessage.parse({
    type: "command",
    commandID: "legacy-command",
    method: "tabs.list",
    params: {},
  })

  expect(legacy.type).toBe("command")
  if (legacy.type !== "command") throw new Error("Expected a browser command.")
  expect(legacy.contractVersion).toBeUndefined()
  expect(supportsBrowserCommandContractVersion(legacy.contractVersion)).toBe(true)
  expect(supportsBrowserCommandContractVersion(2)).toBe(false)
})
