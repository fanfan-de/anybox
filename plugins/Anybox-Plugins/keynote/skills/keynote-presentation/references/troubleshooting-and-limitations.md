# Troubleshooting and Known Limitations

## Common errors

| Problem | Cause | Fix |
|---------|-------|-----|
| Text shows 1-2 chars | font_size > 48 clips in auto-sized box | resize_element → edit_text_item (see font-size-workaround.md) |
| No background visible | Theme incompatible with Blank layout | Use Slate, Bold Colour, or Basic Black (see theme-reference.md) |
| Elements overlap | Multi-line content taller than expected | get_slide_content → check y + height → move_element |
| MCP returns old behavior | Server running old code after edits | Restart MCP server (/mcp or restart session) |
| "Could not find effect popover" (-2700) | Keynote inspector not on correct slide | Call `select_slide(slide_number=N)` first, then retry `add_build_in` |
| add_builds_to_slide not found | Tool registered but server not restarted | Restart MCP server |

## Known MCP limitations

These CANNOT be automated via AppleScript/MCP — require manual fix in Keynote UI:

### Connection line routing
Keynote connection lines between shapes render on top of all elements. Their routing cannot be controlled via AppleScript. If arrows cross through boxes, you must manually reroute them in Keynote: click the line → drag yellow routing handles.

### Build order reordering
The Build Order panel uses custom Core Animation rendering not exposed to accessibility APIs. Build order is auto-assigned by Keynote in the order builds are added. To change order, use Keynote UI: View → Animate → Build Order.

### "With Previous" build timing
Only available in the Build Order panel. Cannot be set via UI scripting. All builds added via MCP use "On Click" trigger by default.

### Shape fill color
Shape `background fill type` and `background color` are read-only in AppleScript (error -10006). Use the opacity workaround: `add_shape(opacity=8)` creates a semi-transparent container.

## Important: modifying existing presentations

- ALWAYS use `get_slide_content` to check current property values before modifying
- Do NOT assume defaults — existing slides may use different opacity, font sizes, or positions than what this skill recommends for new slides
- Record original values so you can revert accurately if needed
- When changing opacity: note the original value first (it may be 100% on existing shapes, not 8%)

## Build animation tips

- `select_slide` BEFORE `add_build_in` when switching between slides
- ~6 seconds per element (UI scripting is slow)
- Keynote must be frontmost with Accessibility permissions
- Bullet dot items ("•") should be skipped — leave them always visible as outline
- Skip empty items at position (0,0) — these are theme placeholders
- For code-heavy slides, consider only building the explanation column, not individual code lines
