/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { TimelineClipContextMenu } from "./TimelineClipContextMenu"

afterEach(cleanup)

describe("TimelineClipContextMenu", () => {
  it("focuses enabled actions, navigates with arrows, and returns focus on Escape", async () => {
    const returnFocus = document.createElement("button")
    document.body.append(returnFocus)
    const onClose = vi.fn()
    const rendered = render(<TimelineClipContextMenu
      menu={{ x: 20, y: 20, label: "Clip actions", returnFocus }}
      onClose={onClose}
      actions={[
        { id: "split", label: "Split", icon: null, disabled: true, onSelect: vi.fn() },
        { id: "duplicate", label: "Duplicate", icon: null, onSelect: vi.fn() },
        { id: "delete", label: "Delete", icon: null, onSelect: vi.fn() },
      ]}
    />)

    const duplicate = screen.getByRole("menuitem", { name: "Duplicate" })
    const remove = screen.getByRole("menuitem", { name: "Delete" })
    await waitFor(() => expect(duplicate).toHaveFocus())
    fireEvent.keyDown(duplicate, { key: "ArrowDown" })
    expect(remove).toHaveFocus()
    fireEvent.keyDown(remove, { key: "ArrowUp" })
    expect(duplicate).toHaveFocus()
    fireEvent.keyDown(document, { key: "Escape" })
    expect(onClose).toHaveBeenCalledTimes(1)
    rendered.unmount()
    expect(returnFocus).toHaveFocus()
  })

  it("selects an action and closes the menu", () => {
    const onClose = vi.fn()
    const onSelect = vi.fn()
    render(<TimelineClipContextMenu
      menu={{ x: 20, y: 20, label: "Clip actions", returnFocus: document.body }}
      onClose={onClose}
      actions={[{ id: "duplicate", label: "Duplicate", icon: null, onSelect }]}
    />)
    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledTimes(1)
  })
})
