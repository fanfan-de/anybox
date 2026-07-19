import { describe, expect, test } from "vitest"
import {
  ANYBOX_CHROME_EXTENSION_ID,
  BROWSER_EXTENSION_PROTOCOL_VERSION,
  BrowserExtensionCommandContext,
  BrowserExtensionHelloMessage,
  BrowserExtensionResultMessage,
  BrowserExtensionServerMessage,
} from "./browser-extension"

describe("Browser Extension result envelope", () => {
  test("preserves optional stable error metadata across Native Messaging", () => {
    const result = {
      type: "result",
      commandID: "command-1",
      ok: false,
      error: "Extension result does not match the Browser Contract.",
      code: "INVALID_COMMAND_RESULT",
      retryable: false,
    } as const

    expect(BrowserExtensionResultMessage.parse(result)).toEqual(result)
  })

  test("negotiates an exact optional command capability list", () => {
    const hello = {
      type: "hello",
      protocolVersion: BROWSER_EXTENSION_PROTOCOL_VERSION,
      extensionInstanceID: "extension-instance",
      extensionID: ANYBOX_CHROME_EXTENSION_ID,
      version: "0.2.0",
      capabilities: {
        contractVersion: 1,
        commands: ["tabs.list", "page.screenshot"],
      },
    } as const

    expect(BrowserExtensionHelloMessage.parse(hello)).toEqual(hello)
    expect(BrowserExtensionHelloMessage.safeParse({
      ...hello,
      capabilities: {
        contractVersion: 2,
        commands: ["page.notReal"],
      },
    }).success).toBe(true)
  })

  test("accepts a legacy v1 Agent command envelope without a contract version", () => {
    expect(BrowserExtensionServerMessage.parse({
      type: "command",
      commandID: "legacy-command",
      method: "tabs.list",
      params: {},
    })).toEqual({
      type: "command",
      commandID: "legacy-command",
      method: "tabs.list",
      params: {},
    })
  })

  test("normalizes bounded command context identifiers and rejects whitespace labels", () => {
    expect(BrowserExtensionCommandContext.parse({
      sessionID: " session-1 ",
    })).toEqual({ sessionID: "session-1" })
    expect(BrowserExtensionCommandContext.safeParse({
      sessionID: "   ",
    }).success).toBe(false)
    expect(BrowserExtensionCommandContext.safeParse({
      toolCallID: "x".repeat(257),
    }).success).toBe(false)
  })
})
