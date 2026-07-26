import type { SemanticTokenAuthoringOperation } from "../../../../shared/semantic-token-authoring"
import {
  createSemanticTokenAuthoringHistoryState,
  semanticTokenAuthoringSessionReducer,
} from "./semantic-token-authoring-session"

const firstBinding: SemanticTokenAuthoringOperation = {
  kind: "binding-edit",
  channelID: "background-color",
  cssProperty: "background-color",
  runtimeToken: "semantic-button-surface",
  editRef: "edit-1",
  selector: ".button",
  sourceLabel: "button.css",
}

describe("semantic token authoring session reducer", () => {
  it("replaces duplicate edits and supports undo, redo, and discard", () => {
    let state = createSemanticTokenAuthoringHistoryState()
    state = semanticTokenAuthoringSessionReducer(state, { type: "upsert", operation: firstBinding })
    state = semanticTokenAuthoringSessionReducer(state, {
      type: "upsert",
      operation: { ...firstBinding, runtimeToken: "semantic-button-surface-hover" },
    })
    expect(state.present).toHaveLength(1)
    expect(state.present[0]).toMatchObject({ runtimeToken: "semantic-button-surface-hover" })

    state = semanticTokenAuthoringSessionReducer(state, { type: "undo" })
    expect(state.present[0]).toMatchObject({ runtimeToken: "semantic-button-surface" })
    state = semanticTokenAuthoringSessionReducer(state, { type: "redo" })
    expect(state.present[0]).toMatchObject({ runtimeToken: "semantic-button-surface-hover" })
    state = semanticTokenAuthoringSessionReducer(state, { type: "discard" })
    expect(state).toEqual(createSemanticTokenAuthoringHistoryState())
  })

  it("applies token creation and binding as one history step", () => {
    let state = createSemanticTokenAuthoringHistoryState()
    state = semanticTokenAuthoringSessionReducer(state, {
      type: "batch-upsert",
      operations: [
        {
          kind: "token-creation",
          runtimeToken: "semantic-button-custom-surface",
          groupID: "buttons",
          createGroup: false,
          layer: "component",
          label: "Custom Button Surface",
          description: "Custom button surface.",
          light: { value: "#ffffff" },
          dark: { value: "#111111" },
        },
        {
          ...firstBinding,
          runtimeToken: "semantic-button-custom-surface",
        },
      ],
    })
    expect(state.present).toHaveLength(2)
    state = semanticTokenAuthoringSessionReducer(state, { type: "undo" })
    expect(state.present).toEqual([])
  })
})
