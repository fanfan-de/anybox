# Cinema Web TODO

## Reduce noisy viewport autosaves

Status: open

The canvas currently saves too aggressively when the user only pans or zooms the main view. React Flow `onMoveEnd` sends an `update-viewport` command immediately, which goes through the same save indicator and backend command pipeline as real canvas content edits.

Observed behavior:

- Zooming or panning the main canvas flips the top bar save indicator to `Saving` / `Saved`.
- Each viewport command writes `canvas.json` and appends a command event.
- This makes the app feel like it is constantly saving even when nodes, edges, and generation data have not changed.

Relevant code:

- `src/App.tsx`: `onMoveEnd` sends `update-viewport`.
- `src/App.tsx`: `commandMutation` drives the visible save indicator for all command types.
- `packages/anyboxagent/src/server/usecases/cinema.ts`: `applyCinemaCommand` writes the canvas and appends an event for every command.

Potential fixes:

- Debounce viewport persistence, for example 1.5-3 seconds after the last move.
- Skip saves for tiny viewport changes using x/y/zoom thresholds.
- Treat viewport saves as background UI-state persistence so they do not show the primary `Saving` indicator.
- Consider storing viewport locally if the view should be per-device rather than shared project state.

