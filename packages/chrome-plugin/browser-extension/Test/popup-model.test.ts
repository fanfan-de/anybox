import { describe, expect, test } from "bun:test"
import {
  cleanupPresentation,
  controlPresentation,
  resolvePopupLocale,
  statusPresentation,
} from "../src/popup/model"

describe("Chrome popup presentation", () => {
  test("selects Chinese for any zh locale and English otherwise", () => {
    expect(resolvePopupLocale("zh-TW")).toBe("zh-CN")
    expect(resolvePopupLocale("en-GB")).toBe("en-US")
    expect(resolvePopupLocale()).toBe("en-US")
  })

  test("keeps bridge status separate from the paused control state", () => {
    expect(statusPresentation({
      state: "connected",
      lastChecked: 1,
      controlPaused: true,
    }, "zh-CN")).toMatchObject({
      state: "connected",
      label: "已连接",
    })
    expect(controlPresentation({
      paused: true,
      activeTabs: 0,
      handoffTabs: 0,
      agentTabs: 0,
      userTabs: 0,
      sessionCount: 0,
      updatedAt: 1,
    }, "zh-CN")).toMatchObject({
      paused: true,
      detail: "控制已停止；现有标签页会保持打开。",
    })
  })

  test("summarizes active and handed-off tabs without exposing page data", () => {
    const presentation = controlPresentation({
      paused: false,
      activeTabs: 2,
      handoffTabs: 1,
      agentTabs: 2,
      userTabs: 1,
      sessionCount: 2,
      updatedAt: 1,
    }, "en-US")

    expect(presentation).toEqual({
      paused: false,
      totalTabs: 3,
      badge: "3 tabs",
      detail: "2 active · 1 handed off",
    })
  })

  test("keeps technical cleanup data behind diagnostics", () => {
    expect(cleanupPresentation({
      state: "disconnected",
      lastChecked: 1,
      cleanup: {
        closed: 1,
        released: 2,
        deliverable: 3,
        handoff: 4,
        detached: 5,
        completedAt: 1,
      },
    }, "en-US")).toBe(
      "1 closed · 2 released · 3 delivered · 4 handed off",
    )
  })
})
