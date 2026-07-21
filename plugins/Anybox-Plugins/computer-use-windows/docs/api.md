# Computer Use Windows `sky` API

Load the plugin client in Anybox Node REPL, then use the persistent global `sky` object.

```js
const apps = await sky.list_apps();
const window = apps.flatMap((app) => app.windows)[0];
const state = await sky.get_window_state({
  window,
  include_screenshot: true,
  include_text: true,
});
```

Supported surface:

```ts
type Window = { app: string; id: number; title?: string };

sky.target: "windows";
sky.list_apps(): Promise<Array<{
  id: string;
  displayName?: string;
  isRunning?: boolean;
  windows: Window[];
}>>;
sky.list_windows(): Promise<Window[]>;
sky.get_window({ id, app? }): Promise<Window>;
sky.launch_app({ app, purpose?, safety? }): Promise<void>;
sky.get_window_state({
  window,
  include_screenshot?,
  include_text?,
}): Promise<{
  window: Window;
  screenshots: Array<{
    id: string;
    url: string;
    zIndex: number;
    originX?: number;
    originY?: number;
    width?: number;
    height?: number;
  }>;
  accessibility: null | {
    tree: string;
    focused_element?: string;
    selected_text?: string;
    selected_elements?: string[];
    document_text?: string;
  };
}>;

sky.click({
  window,
  element_index?,
  screenshotId?, x?, y?,
  mouse_button?, click_count?,
  purpose?, safety?,
}): Promise<void>;
sky.press_key({ window, key, purpose?, safety? }): Promise<void>;
sky.type_text({ window, text, purpose?, safety? }): Promise<void>;
sky.scroll({ window, screenshotId?, x, y, scrollX, scrollY, purpose?, safety? }): Promise<void>;
sky.set_value({ window, element_index, value, purpose?, safety? }): Promise<void>;
sky.drag({ window, screenshotId?, from_x, from_y, to_x, to_y, purpose?, safety? }): Promise<void>;
sky.perform_secondary_action({
  window,
  element_index,
  action: "toggle" | "select" | "expand" | "collapse",
  purpose?, safety?,
}): Promise<void>;
sky.activate_window({ window, purpose?, safety? }): Promise<void>;
```

`click` accepts exactly one target mode: `element_index`, or coordinates from the latest screenshot. Input actions consume the latest state even when an action fails.

Key chords use `+`, such as `Control_L+a`, `Ctrl+Shift+s`, `Return`, or `Escape`. Windows-key shortcuts, secure attention sequences, and unsupported keys are rejected.

Unlike Codex's broader Windows client, `launch_app` intentionally accepts only a current catalog id from `list_apps`; arbitrary executable paths are outside this plugin's security contract.

All desktop-access methods display the Helper-owned blue safety overlay before
observing or controlling Windows. `initialize` and `computer_health_check` keep
it hidden. `CU_OVERLAY_UNAVAILABLE` is fail-closed: stop Computer Use for the
current turn rather than retrying without the indicator.
