import {
  isBindableSemanticRuntimeToken,
  isValidSemanticRuntimeTokenName,
  recommendSemanticRuntimeTokenName,
  semanticTokenAuthoringOperationKey,
} from "./semantic-token-authoring"

describe("semantic token authoring helpers", () => {
  it("recommends a stable component/channel/state runtime name", () => {
    expect(recommendSemanticRuntimeTokenName({
      selector: "button.plugins-included-row.is-expanded:hover",
      channel: "background",
      state: "expanded",
    })).toBe("semantic-plugins-included-row-surface-expanded")
  })

  it("only accepts semantic runtime tokens as component bindings", () => {
    expect(isBindableSemanticRuntimeToken("semantic-button-surface", "component")).toBe(true)
    expect(isBindableSemanticRuntimeToken("semantic-status-danger", "status")).toBe(true)
    expect(isBindableSemanticRuntimeToken("surface-panel", "foundation")).toBe(false)
    expect(isBindableSemanticRuntimeToken("brand-primary", "global")).toBe(false)
    expect(isBindableSemanticRuntimeToken("semantic-mix-overlay", "component")).toBe(false)
    expect(isBindableSemanticRuntimeToken("semantic-button-surface-light", "component")).toBe(false)
    expect(isValidSemanticRuntimeTokenName("semantic-button-surface")).toBe(true)
    expect(isValidSemanticRuntimeTokenName("semantic-button-surface-dark")).toBe(false)
  })

  it("deduplicates draft concepts by selector/property, mode, or runtime", () => {
    expect(semanticTokenAuthoringOperationKey({
      kind: "binding-edit",
      channelID: "background-color",
      cssProperty: "background-color",
      runtimeToken: "semantic-button-surface",
      editRef: "opaque-1",
      selector: ".button",
      sourceLabel: "button.css",
    })).toBe("binding:opaque-1:background-color")
    expect(semanticTokenAuthoringOperationKey({
      kind: "theme-token-value-edit",
      runtimeToken: "semantic-button-surface",
      mode: "dark",
      action: "set",
      value: "#111111",
    })).toBe("theme:semantic-button-surface:dark")
  })
})
