---
name: keynote-presentation
description: Creates polished Keynote presentations via the Anybox Keynote MCP tools. Use when the user asks to create a presentation, make slides, build a deck, 制作演示文稿, 制作幻灯片, or mentions Keynote. Handles font clipping bugs, theme pitfalls, coordinate math, build animations, and landing-page-style slide design. Do NOT use for PowerPoint or Google Slides.
license: MIT
metadata:
    author: Anybox + ByAxe
    version: 2.0.0-anybox.1
    mcp-server: plugin.keynote.control
    category: design
    tags: [keynote, presentations, slides, mcp]
---

# Keynote Presentation Builder

Build polished Keynote presentations using keynote-mcp MCP tools. This skill encodes domain expertise about Keynote's AppleScript quirks, layout math, and design patterns.

This Anybox bundle targets the installed MCP server `plugin.keynote.control`. It is available only on macOS with Keynote installed. If the server diagnostic reports that `uv` is missing, stop and direct the user to the plugin's installation instructions instead of attempting unrelated package installation.

## CRITICAL: Font Size Bug

`add_title` with font_size > 48 creates a tiny text box that clips to 1-2 characters.

**Workaround** (always use for large titles):
1. `add_title(slide_number=1, title="My Title", x=480, y=260, font_size=96)`
2. `get_slide_content(slide_number=1)` — find the element index N
3. `resize_element(slide_number=1, element_type="text", element_index=N, width=900, height=140)`
4. `edit_text_item(slide_number=1, item_index=N, new_text="My Title")` — restore truncated text

**Safe sizes (no workaround needed):** title <=48pt, subtitle <=32pt, bullets <=28pt, code <=20pt

See `references/font-size-workaround.md` for detailed examples.

## Workflow

### Step 1: Setup
```
get_slide_size()
get_available_themes()
create_presentation(title="...", theme="Slate")
set_slide_layout(slide_number=1, layout="Blank")
```
- Use **Slate** theme by default (dark gradient, works on Blank layout)
- Always set slides to **Blank** layout — themed layouts inject invisible placeholders
- See `references/theme-reference.md` for full compatibility table

### Step 2: Batch-create slides
Add all slides before content to avoid index confusion:
```
add_slide(position=2)
add_slide(position=3)
```

### Step 3: Add content
- Center text manually: `x = 960 - (char_count * px_per_char / 2)`
- See `references/coordinate-reference.md` for width estimates per font size
- See `references/slide-templates.md` for hero, statement, bullets, code, and closing patterns
- Use `references/shape-and-styling.md` for containers, colors, and two-column layouts

### Step 4: Verify every slide
CRITICAL: Always screenshot and visually inspect after building each slide.
```
screenshot_slide(slide_number=N, output_path="/tmp/slideN.png")
```
Inspect the returned image in Anybox. Check for:
- Text clipping (only 1-2 characters visible)
- Element overlaps (compare y + height vs next element y)
- Content overflowing slide edges
- Alignment issues

Fix with `move_element`, `resize_element`, or `edit_text_item`.

### Step 5: Build animations (optional)
Add click-to-reveal effects so content appears incrementally during presentation:
```
get_slide_content(slide_number=N)
add_builds_to_slide(slide_number=N, element_indices="5,7,9,11,13")
```
- **Never build shapes** — container shapes are structural, always visible
- Auto-skips bullet dot items ("•")
- Requires Keynote frontmost + Accessibility permissions
- ~6 seconds per element (UI scripting)
- See `references/build-animation-reference.md` for details

## Design Principles

Treat each slide as one section of a landing page. **One idea per slide.**

Maximum content per slide:
- 1 title + 1 subtitle + 3-5 bullets, OR
- 1 title + 1 code block (6 lines max), OR
- 1 centered quote/statement

### Font hierarchy
| Size | Use |
|------|-----|
| 96pt | Hero title only (needs resize workaround) |
| 64-72pt | Section titles |
| 48pt | Large statements/quotes |
| 28-32pt | Subtitles |
| 24-26pt | Body text, bullets |
| 20pt | Code blocks |
| 18pt | Footnotes, captions |

### Recommended fonts
- Titles: "Helvetica Neue Bold"
- Subtitles: "Helvetica Neue Light"
- Code: "Menlo"

## Working with Existing Presentations

When adding to an existing deck:
1. `duplicate_slide(slide_number=N)` — preserves theme/background
2. `clear_slide(slide_number=M)` — removes content, keeps background
3. Build new content on the cleared slide

See `references/existing-presentation-guide.md` for patterns.

## Element Management

- Always `get_slide_content` before modifying elements
- Delete from **highest index to lowest** to avoid index shifting
- Theme placeholder ghosts at (0,0) cannot be deleted — ignore them
- Calculate overlaps: if element at y=300 has height=638, it extends to y=938

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Text shows 1-2 chars | resize_element + edit_text_item |
| No background visible | Use Slate, Bold Colour, or Basic Black |
| Elements overlap | get_slide_content → check heights → move_element |
| MCP old behavior | Disable and re-enable the Keynote MCP server in Anybox plugin settings |
| add_build_in popover error | Call `select_slide` first, then retry |

See `references/troubleshooting-and-limitations.md` for detailed limitations and known issues.

## Performance Notes
- Take your time with each slide. Quality is more important than speed.
- Do not skip the screenshot verification step.
- When in doubt about coordinates, use get_slide_content to check actual positions.

## Quick Reference Checklist
1. `get_slide_size` → confirm dimensions
2. `get_available_themes` → pick theme (Slate recommended)
3. `create_presentation` with theme
4. Add all slides, set to Blank layout
5. Build content using templates from `references/slide-templates.md`
6. For large titles (>48pt): add → get index → resize → edit_text_item
7. Screenshot each slide → Read image → verify
8. Fix overlaps: get_slide_content → calculate → move_element
9. Add build animations if needed
10. Final screenshot pass of all slides
