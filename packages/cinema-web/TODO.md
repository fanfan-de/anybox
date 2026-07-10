# Cinema Web TODO

## Persist and restore the canvas viewport

Status: open

The Canvas schema still contains a viewport, but the current React Flow surface starts with `fitView` and does not restore or persist viewport changes.

Observed behavior:

- Opening a project fits the full graph instead of restoring the last working position.
- Zooming or panning does not write an `update-viewport` command.
- The saved viewport therefore remains unused legacy state.

Relevant code:

- `src/App.tsx`: React Flow uses `fitView` without an `onMoveEnd` persistence handler.
- `@anybox/shared/cinema`: `CinemaCanvasDocument` still contains `viewport`.

Potential fixes:

- Decide whether viewport is shared project state or per-device UI state.
- If shared, debounce `update-viewport` commands and ignore tiny x/y/zoom changes.
- If per-device, move it out of the shared Canvas document and store it locally.
- Keep viewport persistence out of the primary save indicator unless the project contract requires it.

