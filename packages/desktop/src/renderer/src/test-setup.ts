import "@testing-library/jest-dom/vitest"
import { configure } from "@testing-library/react"
import { vi } from "vitest"

configure({ asyncUtilTimeout: 10_000 })

function createStorageMock(): Storage {
  const values = new Map<string, string>()

  return {
    get length() {
      return values.size
    },
    clear: () => {
      values.clear()
    },
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key)
    },
    setItem: (key, value) => {
      values.set(key, String(value))
    },
  }
}

function ensureStorage(name: "localStorage" | "sessionStorage") {
  try {
    window[name]?.getItem("__storage_probe__")
  } catch {
    Object.defineProperty(window, name, {
      configurable: true,
      value: createStorageMock(),
    })
  }

  if (!window[name]) {
    Object.defineProperty(window, name, {
      configurable: true,
      value: createStorageMock(),
    })
  }
}

ensureStorage("localStorage")
ensureStorage("sessionStorage")

class MockResizeObserver implements ResizeObserver {
  private readonly callback: ResizeObserverCallback

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
  }

  observe(target: Element) {
    const rect = target.getBoundingClientRect()
    this.callback([
      {
        borderBoxSize: [],
        contentBoxSize: [],
        contentRect: rect,
        devicePixelContentBoxSize: [],
        target,
      },
    ], this)
  }

  unobserve() {}

  disconnect() {}
}

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = MockResizeObserver
}

class MockTerminal {
  rows = 24
  cols = 80
  buffer = {
    active: {
      viewportY: 0,
    },
  }

  private element: HTMLElement | null = null
  private readonly dataListeners = new Set<(data: string) => void>()
  private readonly scrollListeners = new Set<() => void>()
  private handleKeyDown: ((event: KeyboardEvent) => void) | null = null

  loadAddon(addon: { activate?: (terminal: MockTerminal) => void }) {
    addon.activate?.(this)
  }

  open(element: HTMLElement) {
    if (this.element && this.handleKeyDown) {
      this.element.removeEventListener("keydown", this.handleKeyDown)
    }
    this.element = element
    this.element.tabIndex = -1
    this.element.textContent = ""
    this.handleKeyDown = (event) => {
      const data = event.key === "Enter"
        ? "\r"
        : event.key === "Backspace"
          ? "\x7f"
          : event.key.length === 1
            ? event.key
            : ""
      if (!data) return
      for (const listener of this.dataListeners) {
        listener(data)
      }
    }
    this.element.addEventListener("keydown", this.handleKeyDown)
  }

  write(data: string, callback?: () => void) {
    if (this.element) {
      this.element.textContent = `${this.element.textContent ?? ""}${data}`
    }
    callback?.()
  }

  onData(listener: (data: string) => void) {
    this.dataListeners.add(listener)
    return {
      dispose: () => {
        this.dataListeners.delete(listener)
      },
    }
  }

  onScroll(listener: () => void) {
    this.scrollListeners.add(listener)
    return {
      dispose: () => {
        this.scrollListeners.delete(listener)
      },
    }
  }

  focus() {
    this.element?.focus()
  }

  reset() {
    if (this.element) {
      this.element.textContent = ""
    }
  }

  scrollToLine(line: number) {
    this.buffer.active.viewportY = line
  }

  dispose() {
    if (this.element && this.handleKeyDown) {
      this.element.removeEventListener("keydown", this.handleKeyDown)
    }
    this.dataListeners.clear()
    this.scrollListeners.clear()
    this.element = null
    this.handleKeyDown = null
  }
}

class MockFitAddon {
  private terminal: MockTerminal | null = null

  activate(terminal: MockTerminal) {
    this.terminal = terminal
  }

  fit() {}

  proposeDimensions() {
    const override = (globalThis as { __mockXtermFitDimensions?: { rows: number; cols: number } | null }).__mockXtermFitDimensions
    if (override === null) return undefined
    if (override) return override

    return {
      rows: this.terminal?.rows ?? 24,
      cols: this.terminal?.cols ?? 80,
    }
  }

  dispose() {
    this.terminal = null
  }
}

vi.mock("@xterm/xterm", () => ({
  Terminal: MockTerminal,
}))

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: MockFitAddon,
}))
