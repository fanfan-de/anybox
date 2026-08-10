import { describe, expect, it, vi } from "vitest"
import { registerDesktopProtocolSchemes } from "./protocol-schemes"

describe("desktop protocol schemes", () => {
  it("registers every privileged scheme in Electron's single allowed call", () => {
    const registerSchemesAsPrivileged = vi.fn()

    registerDesktopProtocolSchemes({ registerSchemesAsPrivileged })

    expect(registerSchemesAsPrivileged).toHaveBeenCalledTimes(1)
    expect(registerSchemesAsPrivileged).toHaveBeenCalledWith([
      {
        scheme: "anybox-local-image",
        privileges: {
          standard: true,
          secure: true,
          supportFetchAPI: true,
        },
      },
      {
        scheme: "anybox-local-video",
        privileges: {
          standard: true,
          secure: true,
          supportFetchAPI: true,
          stream: true,
        },
      },
      {
        scheme: "anybox-preview",
        privileges: {
          standard: true,
          secure: true,
          supportFetchAPI: true,
          stream: true,
        },
      },
    ])
  })
})
