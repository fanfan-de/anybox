# Computer Use Windows `sky` API

Load the plugin client in Anybox Node REPL, then use the session-scoped persistent global `sky` object. A new Anybox session or `js_reset` replaces the kernel process and requires initialization again.

Node REPL code runs as an async function body, so values are visible only when
they are explicitly returned or written. Preserve reusable handles on
`globalThis`; a bare expression such as `await sky.list_apps()` executes but
produces a `null` tool result.

```js
globalThis.computerUseApps = await sky.list_apps();
globalThis.computerUseWindow = globalThis.computerUseApps.flatMap((app) => app.windows)[0];
globalThis.computerUseState = await sky.get_window_state({
  window: globalThis.computerUseWindow,
  include_screenshot: true,
  include_text: true,
});
return globalThis.computerUseState;
```

Supported surface:

```ts
type Window = { app: string; id: number; title?: string };
type Screenshot = {
  id: string;
  zIndex: number;
  image_emitted: boolean;
  mime_type?: string;
  readonly url?: string; // local non-enumerable compatibility accessor
  originX?: number;
  originY?: number;
  width?: number;
  height?: number;
};
type AccessibilityState = {
  tree: string;
  focused_element?: string;
  selected_text?: string;
  selected_elements?: string[];
  document_text?: string;
};
type WindowState = {
  window: Window;
  viewport: {
    x: number; y: number; width: number; height: number;
    is_foreground: boolean;
    minimized: boolean;
    coordinate_space: "screen";
    action_coordinate_space: "screenshot-local";
  };
  screenshots: Screenshot[];
  accessibility: AccessibilityState | null;
};
type ActionReceipt = {
  ok: boolean;
  state_consumed: boolean;
  input_mode?: "uia" | "physical";
  focus_validated?: boolean;
  element_index?: number;
  character_count?: number;
  post_state?: WindowState;
  observation_error?: {
    code: string;
    message: string;
    retryable: boolean;
    requires_fresh_state: boolean;
  };
};

sky.target: "windows";
sky.list_apps(): Promise<Array<{
  id: string;
  displayName?: string;
  isRunning?: boolean;
  windows: Window[];
}>>;
sky.list_windows(): Promise<Window[]>;
sky.get_window({ id, app? }): Promise<Window>;
sky.launch_app({ app, purpose?, safety? }): Promise<{
  ok: boolean;
  app: string;
  window_ready: boolean;
  window?: Window;
}>;
sky.get_window_state({
  window,
  include_screenshot?,
  include_text?,
}): Promise<WindowState>;

sky.click({
  window,
  element_index?,
  screenshotId?, x?, y?,
  mouse_button?, click_count?,
  observe_after?, purpose?, safety?,
}): Promise<ActionReceipt>;
sky.press_key({ window, key, observe_after?, purpose?, safety? }): Promise<ActionReceipt>;
sky.type_text({ window, text, observe_after?, purpose?, safety? }): Promise<ActionReceipt>;
sky.scroll({
  window,
  element_index?,
  screenshotId?, x?, y?,
  scrollX, scrollY,
  observe_after?, purpose?, safety?,
}): Promise<ActionReceipt>;
sky.set_value({ window, element_index, value, observe_after?, purpose?, safety? }): Promise<ActionReceipt>;
sky.drag({ window, screenshotId?, from_x, from_y, to_x, to_y, observe_after?, purpose?, safety? }): Promise<ActionReceipt>;
sky.perform_secondary_action({
  window,
  element_index,
  action: "toggle" | "select" | "expand" | "collapse",
  observe_after?, purpose?, safety?,
}): Promise<ActionReceipt>;
sky.activate_window({ window, purpose?, safety? }): Promise<{ ok: boolean; window: Window }>;
```

`click` and `scroll` accept exactly one target mode: `element_index`, or
coordinates from the latest screenshot. Element actions first use a UI
Automation pattern and do not require the Helper to activate the foreground
when that semantic pattern succeeds. Only their physical fallback explicitly
activates the target window; an application UIA provider may still update its
own focus as part of the semantic action.

Input actions consume the latest state even when an action fails. Set
`observe_after: true` to capture and return a new state after a successful
action in the same JavaScript submission. The new state becomes the next fresh
state; if its capture fails, the action receipt remains successful and reports
`observation_error` because the action may already have taken effect.

Use `include_text: true` before `type_text`. When that state has accessibility
data, the Helper rejects password focus and non-editable focus with a structured
error instead of reporting a false typing success. `input_mode` and
`focus_validated` in the receipt state which path was actually used.

Screenshot pixels are delivered through the Node REPL image channel. The local
JavaScript object retains a non-enumerable `url` compatibility property, but it
is omitted from serialized `WindowState`, so tool results do not duplicate the
base64 payload. Enumerable screenshot entries contain coordinate metadata and
`image_emitted` status.

Key chords use `+`, such as `Control_L+a`, `Ctrl+Shift+s`, `Return`, or `Escape`. Windows-key shortcuts, secure attention sequences, and unsupported keys are rejected.

Unlike Codex's broader Windows client, `launch_app` intentionally accepts only a current catalog id from `list_apps`; arbitrary executable paths are outside this plugin's security contract.

All desktop-access methods display the Helper-owned blue safety overlay before
observing or controlling Windows. `initialize` and `computer_health_check` keep
it hidden. `CU_OVERLAY_UNAVAILABLE` is fail-closed: stop Computer Use for the
current turn rather than retrying without the indicator.
