import { describe, expect, test } from "bun:test"
import "./sqlite.cleanup.ts"
import {
  allowComputerUseApp,
  evaluateComputerUseAdminPolicy,
  getComputerUseAppDecision,
  listComputerUseAppDecisions,
  revokeComputerUseApp,
} from "../src/mcp/computer-use/app-policy.ts"

describe("Computer Use persistent app policy", () => {
  test("stores, updates, lists, and revokes always-allow decisions", () => {
    expect(listComputerUseAppDecisions()).toEqual([])
    const first = allowComputerUseApp({
      appID: "app_notepad",
      displayName: "Notepad",
    })
    expect(first.decision).toBe("allow")
    expect(getComputerUseAppDecision("app_notepad")?.displayName).toBe("Notepad")

    const updated = allowComputerUseApp({
      appID: "app_notepad",
      displayName: "Windows Notepad",
    })
    expect(updated.createdAt).toBe(first.createdAt)
    expect(updated.updatedAt).toBeGreaterThanOrEqual(first.updatedAt)
    expect(listComputerUseAppDecisions()).toHaveLength(1)
    expect(listComputerUseAppDecisions()[0]?.displayName).toBe("Windows Notepad")

    expect(revokeComputerUseApp("app_notepad")).toBe(true)
    expect(revokeComputerUseApp("app_notepad")).toBe(false)
    expect(listComputerUseAppDecisions()).toEqual([])
  })

  test("enforces host administrator deny policy before user grants", () => {
    expect(evaluateComputerUseAdminPolicy("app_notepad", {})).toEqual({
      denied: false,
    })
    expect(evaluateComputerUseAdminPolicy("app_notepad", {
      ANYBOX_COMPUTER_USE_DENY_APP_IDS: "app_calc; APP_NOTEPAD",
    })).toEqual({
      denied: true,
      reason: "This application is blocked by administrator policy.",
    })
    expect(evaluateComputerUseAdminPolicy("app_notepad", {
      ANYBOX_COMPUTER_USE_DENY_APP_IDS: "*",
    }).denied).toBe(true)
    expect(evaluateComputerUseAdminPolicy("app_notepad", {
      ANYBOX_COMPUTER_USE_DISABLED: "true",
    })).toEqual({
      denied: true,
      reason: "Computer Use is disabled by administrator policy.",
    })
  })
})
