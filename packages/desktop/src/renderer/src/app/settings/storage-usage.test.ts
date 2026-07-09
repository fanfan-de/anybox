import { describe, expect, it } from "vitest"
import { formatStorageBytes, sortArchivedSessionUsage, sortStorageTables } from "./storage-usage"

describe("settings storage usage helpers", () => {
  it("formats storage byte counts compactly", () => {
    expect(formatStorageBytes(0)).toBe("0 B")
    expect(formatStorageBytes(512)).toBe("512 B")
    expect(formatStorageBytes(1536)).toBe("1.50 KB")
    expect(formatStorageBytes(12.5 * 1024 * 1024)).toBe("12.5 MB")
    expect(formatStorageBytes(null)).toBe("Unknown")
  })

  it("sorts storage tables and archived sessions by estimated size", () => {
    expect(
      sortStorageTables([
        { name: "z", category: "otherDatabase", rowCount: 1, estimatedBytes: 1 },
        { name: "a", category: "activeSessions", rowCount: 1, estimatedBytes: 5 },
        { name: "b", category: "activeSessions", rowCount: 1, estimatedBytes: 5 },
      ]).map((table) => table.name),
    ).toEqual(["a", "b", "z"])

    expect(
      sortArchivedSessionUsage([
        {
          id: "older",
          title: "Older",
          projectID: "project",
          projectName: null,
          directory: "/tmp",
          updated: 1,
          archivedAt: 2,
          messageCount: 1,
          eventCount: 1,
          estimatedBytes: 10,
        },
        {
          id: "newer",
          title: "Newer",
          projectID: "project",
          projectName: null,
          directory: "/tmp",
          updated: 1,
          archivedAt: 3,
          messageCount: 1,
          eventCount: 1,
          estimatedBytes: 10,
        },
      ]).map((session) => session.id),
    ).toEqual(["newer", "older"])
  })
})
