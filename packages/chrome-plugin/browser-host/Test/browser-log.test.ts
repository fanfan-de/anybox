import { afterEach, describe, expect, test } from "bun:test"
import {
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs"
import os from "node:os"
import path from "node:path"
import {
  create,
  sanitizeLogContext,
} from "../src/log.ts"

const roots: string[] = []

afterEach(() => {
  delete process.env.ANYBOX_BROWSER_HOST_LOG_DIR
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe("Browser Host structured logging", () => {
  test("redacts page data, inputs, credentials, and URL paths", () => {
    const context = sanitizeLogContext({
      origin: "https://example.com",
      url: "https://example.com/private?token=secret",
      text: "typed password",
      nested: {
        cookie: "session=secret",
        message: "Request failed at https://example.com/private?q=secret",
      },
    })
    expect(context).toEqual({
      origin: "https://example.com",
      url: "[redacted]",
      text: "[redacted]",
      nested: {
        cookie: "[redacted]",
        message: "Request failed at https://example.com/…",
      },
    })
  })

  test("writes one sanitized JSONL record", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "anybox-browser-log-"))
    roots.push(root)
    process.env.ANYBOX_BROWSER_HOST_LOG_DIR = root

    create({ service: "test" }).info("command", {
      method: "page.fill",
      params: { text: "secret" },
    })

    const line = readFileSync(
      path.join(root, "browser-host.jsonl"),
      "utf8",
    ).trim()
    const record = JSON.parse(line)
    expect(record).toMatchObject({
      level: "info",
      service: "test",
      event: "command",
      context: {
        method: "page.fill",
        params: "[redacted]",
      },
    })
    expect(line).not.toContain("secret")
  })
})
