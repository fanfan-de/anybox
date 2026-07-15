import type { DesktopRendererMemoryDiagnosticsRecord } from "../shared/desktop-ipc-contract"

const recordsByWebContentsID = new Map<number, DesktopRendererMemoryDiagnosticsRecord>()

export function setRendererMemoryDiagnosticsRecord(record: DesktopRendererMemoryDiagnosticsRecord) {
  recordsByWebContentsID.set(record.webContentsID, record)
}

export function getRendererMemoryDiagnosticsRecord(webContentsID: number) {
  return recordsByWebContentsID.get(webContentsID) ?? null
}

export function deleteRendererMemoryDiagnosticsRecord(webContentsID: number) {
  recordsByWebContentsID.delete(webContentsID)
}

export function listRendererMemoryDiagnosticsRecords() {
  return [...recordsByWebContentsID.values()].sort((left, right) => right.timestamp - left.timestamp)
}

export function attachRendererMemoryDiagnostics<T extends object>(webContentsID: number, details: T) {
  const lastRendererMemoryDiagnostics = getRendererMemoryDiagnosticsRecord(webContentsID)
  if (!lastRendererMemoryDiagnostics) return details

  return {
    ...details,
    lastRendererMemoryDiagnostics,
  }
}

export function resetRendererMemoryDiagnosticsStoreForTest() {
  recordsByWebContentsID.clear()
}
