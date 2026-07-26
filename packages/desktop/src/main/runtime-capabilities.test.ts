import { describe, expect, it } from "vitest"
import { resolveDesktopRuntimeCapabilities } from "./runtime-capabilities"

describe("desktop runtime capabilities", () => {
  it("enables development features only for an unpackaged explicitly enabled runtime", () => {
    expect(resolveDesktopRuntimeCapabilities({
      developmentFeaturesFlag: "1",
      isPackaged: false,
    })).toEqual({
      developmentFeaturesEnabled: true,
      appearanceAuthoringEnabled: true,
    })
  })

  it("keeps packaged and unflagged runtimes in consumer mode", () => {
    expect(resolveDesktopRuntimeCapabilities({
      developmentFeaturesFlag: "1",
      isPackaged: true,
    })).toEqual({
      developmentFeaturesEnabled: false,
      appearanceAuthoringEnabled: false,
    })
    expect(resolveDesktopRuntimeCapabilities({
      developmentFeaturesFlag: undefined,
      isPackaged: false,
    })).toEqual({
      developmentFeaturesEnabled: false,
      appearanceAuthoringEnabled: false,
    })
  })
})
