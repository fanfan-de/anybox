import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import QRCode from "qrcode"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { DesktopMobileBridgeStatus } from "../../../../shared/desktop-ipc-contract"
import { MobileConnectionPage } from "./MobileConnectionPage"

vi.mock("qrcode", () => ({
  default: {
    toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,PAIRING_QR"),
  },
}))

function createMobileBridgeStatus(overrides: Partial<DesktopMobileBridgeStatus> = {}): DesktopMobileBridgeStatus {
  return {
    running: true,
    host: "0.0.0.0",
    port: 4896,
    token: "legacy-token",
    publicUrl: "https://anybox.com.cn/?token=legacy-token",
    localUrl: "http://127.0.0.1:4896/?token=legacy-token",
    urls: ["http://192.168.1.20:4896/?token=legacy-token"],
    publicPairingUrl: "https://anybox.com.cn/?code=pair-123",
    pairingLocalUrl: "http://127.0.0.1:4896/?code=local-pair",
    pairingUrls: ["http://192.168.1.20:4896/?code=pair-123"],
    pairingExpiresAt: Date.now() + 60_000,
    startedAt: Date.now() - 10_000,
    devices: [],
    cloudRelay: {
      enabled: false,
      state: "disabled",
      baseUrl: null,
      desktopID: null,
      pairingCode: null,
      pairingExpiresAt: null,
      pairingDeepLink: null,
      connectedAt: null,
      account: {
        state: "unknown",
      },
    },
    ...overrides,
  }
}

function createConnectOptionsDeepLink(input: { relay?: string; lan?: string; bridge?: string }) {
  const params = new URLSearchParams()
  if (input.relay) params.set("relay", input.relay)
  if (input.lan) params.set("lan", input.lan)
  if (input.bridge) params.set("bridge", input.bridge)
  return `anybox-mobile://connect-options?${params.toString()}`
}

describe("MobileConnectionPage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    })
    window.desktop = {
      platform: "win32",
      versions: {},
      getInfo: vi.fn(),
      getMobileBridgeStatus: vi.fn().mockResolvedValue(createMobileBridgeStatus()),
      refreshMobilePairingCode: vi.fn(),
      rotateMobileBridgeToken: vi.fn(),
      revokeMobileDevice: vi.fn(),
    }
  })

  it("makes Android QR pairing the primary connection path", async () => {
    render(<MobileConnectionPage />)

    expect(await screen.findByRole("heading", { name: "Scan to connect Anybox Mobile" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Refresh QR/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Copy deep link/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Copy test command/ })).toBeInTheDocument()
    expect(screen.getByText("https://anybox.com.cn/?code=pair-123")).toBeInTheDocument()
    expect(screen.getByText("http://192.168.1.20:4896/?code=pair-123")).toBeInTheDocument()
    expect(screen.getAllByText(/anybox-mobile:\/\/connect-options\?/).length).toBeGreaterThan(0)
    expect(screen.getByText(/corepack pnpm mobile:android:smoke:bridge/)).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Advanced token access" })).toBeInTheDocument()
    expect(screen.queryByText("http://192.168.1.20:4896/?token=legacy-token")).not.toBeInTheDocument()

    await waitFor(() => {
      expect(QRCode.toDataURL).toHaveBeenCalledWith(
        createConnectOptionsDeepLink({ lan: "http://192.168.1.20:4896/?code=pair-123" }),
        expect.objectContaining({ type: "image/png" }),
      )
    })
  })

  it("does not render a phone QR from the local-only address when no LAN URL is available", async () => {
    window.desktop!.getMobileBridgeStatus = vi.fn().mockResolvedValue(createMobileBridgeStatus({
      publicPairingUrl: null,
      publicUrl: null,
      pairingUrls: [],
      urls: [],
    }))

    render(<MobileConnectionPage />)

    expect(await screen.findByText("No local pairing address is available.")).toBeInTheDocument()
    expect(screen.getByText("Unavailable")).toBeInTheDocument()
    expect(QRCode.toDataURL).not.toHaveBeenCalled()
  })

  it("reveals legacy token access only from the advanced section", async () => {
    render(<MobileConnectionPage />)

    fireEvent.click(await screen.findByRole("button", { name: "Show advanced" }))

    expect(screen.getByRole("button", { name: /Copy legacy URL/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Copy token/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Rotate token/ })).toBeInTheDocument()
    expect(screen.getByText("https://anybox.com.cn/?token=legacy-token")).toBeInTheDocument()
    expect(screen.getByText("http://192.168.1.20:4896/?token=legacy-token")).toBeInTheDocument()
  })

  it("copies the Android deep link instead of the legacy token URL", async () => {
    render(<MobileConnectionPage />)

    fireEvent.click(await screen.findByRole("button", { name: /Copy deep link/ }))

    await waitFor(() => {
      expect(window.navigator.clipboard.writeText).toHaveBeenCalledWith(
        createConnectOptionsDeepLink({ lan: "http://192.168.1.20:4896/?code=pair-123" }),
      )
    })
  })

  it("copies the Android bridge smoke command for handoff verification", async () => {
    render(<MobileConnectionPage />)

    fireEvent.click(await screen.findByRole("button", { name: /Copy test command/ }))

    await waitFor(() => {
      expect(window.navigator.clipboard.writeText).toHaveBeenCalledWith(
        `corepack pnpm mobile:android:smoke:bridge -- --url "${createConnectOptionsDeepLink({ lan: "http://192.168.1.20:4896/?code=pair-123" })}"`,
      )
    })
  })

  it("falls back to the public pairing URL when the cloud relay pairing code has expired", async () => {
    window.desktop!.getMobileBridgeStatus = vi.fn().mockResolvedValue(createMobileBridgeStatus({
      cloudRelay: {
        enabled: true,
        state: "connected",
        baseUrl: "https://anybox.com.cn",
        desktopID: "desktop-123",
        pairingCode: "expired-relay-pair",
        pairingExpiresAt: Date.now() - 1_000,
        pairingDeepLink: "anybox-mobile://pair?code=expired-relay-pair&url=https%3A%2F%2Fanybox.com.cn",
        connectedAt: Date.now() - 30_000,
        account: {
          state: "connected",
          email: "owner@example.com",
        },
      },
    }))

    render(<MobileConnectionPage />)

    fireEvent.click(await screen.findByRole("button", { name: /Copy deep link/ }))

    await waitFor(() => {
      expect(window.navigator.clipboard.writeText).toHaveBeenCalledWith(
        createConnectOptionsDeepLink({ lan: "http://192.168.1.20:4896/?code=pair-123" }),
      )
    })
    expect(window.navigator.clipboard.writeText).not.toHaveBeenCalledWith(
      "anybox-mobile://pair?code=expired-relay-pair&url=https%3A%2F%2Fanybox.com.cn",
    )
  })

  it("refreshes only the Android pairing code from the primary pairing panel", async () => {
    const nextStatus = createMobileBridgeStatus({
      token: "legacy-token",
      publicUrl: "https://anybox.com.cn/?token=legacy-token",
      localUrl: "http://127.0.0.1:4896/?token=legacy-token",
      urls: ["http://192.168.1.20:4896/?token=legacy-token"],
      publicPairingUrl: "https://anybox.com.cn/?code=pair-next",
      pairingLocalUrl: "http://127.0.0.1:4896/?code=local-next",
      pairingUrls: ["http://192.168.1.20:4896/?code=pair-next"],
    })
    const desktop = window.desktop!
    desktop.refreshMobilePairingCode = vi.fn().mockResolvedValue(nextStatus)
    desktop.rotateMobileBridgeToken = vi.fn()

    render(<MobileConnectionPage />)

    fireEvent.click(await screen.findByRole("button", { name: /Refresh QR/ }))

    await waitFor(() => {
      expect(desktop.refreshMobilePairingCode).toHaveBeenCalled()
    })
    expect(desktop.rotateMobileBridgeToken).not.toHaveBeenCalled()
    expect(await screen.findByText("https://anybox.com.cn/?code=pair-next")).toBeInTheDocument()
    expect(await screen.findByText("http://192.168.1.20:4896/?code=pair-next")).toBeInTheDocument()

    await waitFor(() => {
      expect(QRCode.toDataURL).toHaveBeenLastCalledWith(
        createConnectOptionsDeepLink({ lan: "http://192.168.1.20:4896/?code=pair-next" }),
        expect.objectContaining({ type: "image/png" }),
      )
    })
  })

  it("includes cloud relay and LAN candidates in one QR code when both are available", async () => {
    const relayDeepLink = "anybox-mobile://pair?code=relay-pair&url=https%3A%2F%2Fanybox.com.cn"
    window.desktop!.getMobileBridgeStatus = vi.fn().mockResolvedValue(createMobileBridgeStatus({
      cloudRelay: {
        enabled: true,
        state: "connected",
        baseUrl: "https://anybox.com.cn",
        desktopID: "desktop-123",
        pairingCode: "relay-pair",
        pairingExpiresAt: Date.now() + 60_000,
        pairingDeepLink: relayDeepLink,
        connectedAt: Date.now() - 30_000,
        account: {
          state: "connected",
          email: "owner@example.com",
        },
      },
    }))

    render(<MobileConnectionPage />)

    const expected = createConnectOptionsDeepLink({
      relay: relayDeepLink,
      lan: "http://192.168.1.20:4896/?code=pair-123",
    })
    await waitFor(() => {
      expect(QRCode.toDataURL).toHaveBeenCalledWith(
        expected,
        expect.objectContaining({ type: "image/png" }),
      )
    })
    expect(await screen.findByText(expected)).toBeInTheDocument()
  })

  it("shows paired devices and revokes an active device", async () => {
    const activeDevice = {
      id: "device-active",
      name: "Pixel 8",
      createdAt: Date.now() - 120_000,
      lastSeenAt: Date.now() - 30_000,
      capabilities: ["workspace:read", "session:read"],
    }
    const revokedDevice = {
      ...activeDevice,
      revokedAt: Date.now(),
    }
    const nextStatus = createMobileBridgeStatus({ devices: [revokedDevice] })
    const desktop = window.desktop!
    desktop.getMobileBridgeStatus = vi.fn().mockResolvedValue(createMobileBridgeStatus({ devices: [activeDevice] }))
    desktop.revokeMobileDevice = vi.fn().mockResolvedValue(nextStatus)

    render(<MobileConnectionPage />)

    expect(await screen.findByRole("heading", { name: "Paired devices" })).toBeInTheDocument()
    expect(screen.getByText("Pixel 8")).toBeInTheDocument()
    expect(screen.getByText("workspace:read, session:read")).toBeInTheDocument()
    expect(screen.getByText("1")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Revoke" }))

    await waitFor(() => {
      expect(desktop.revokeMobileDevice).toHaveBeenCalledWith({ deviceID: "device-active" })
    })
    expect(await screen.findByText("Revoked")).toBeInTheDocument()
  })
})
