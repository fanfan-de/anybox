import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ComputerUseSettingsPanel } from "./ComputerUseSettingsPanel"

describe("ComputerUseSettingsPanel", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    delete (window as typeof window & { desktop?: unknown }).desktop
  })

  it("lists persistent app approvals and revokes one", async () => {
    const revoke = vi.fn().mockResolvedValue({
      appID: "app_notepad",
      revoked: true,
    })
    window.desktop = {
      getComputerUseAppDecisions: vi.fn().mockResolvedValue([
        {
          appID: "app_notepad",
          displayName: "Notepad",
          decision: "allow",
          source: "user",
          createdAt: 1,
          updatedAt: 1,
        },
      ]),
      revokeComputerUseAppDecision: revoke,
    } as unknown as Window["desktop"]

    render(<ComputerUseSettingsPanel />)
    expect(await screen.findByText("Notepad")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }))
    await waitFor(() => {
      expect(revoke).toHaveBeenCalledWith({ appID: "app_notepad" })
      expect(screen.queryByText("Notepad")).not.toBeInTheDocument()
    })
    expect(screen.getByText("No persistent permissions")).toBeInTheDocument()
  })
})
