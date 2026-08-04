# Build Animations (Click-to-Reveal)

Build In animations make elements appear one-by-one during presentation. Each click reveals the next element.

## Batch workflow (recommended)

```yaml
# 1. Check slide content to find text item indices
get_slide_content(slide_number=4)

# 2. Apply builds to all content items
# Auto-skips bullet dot items ("•")
add_builds_to_slide(slide_number=4, element_indices="5,7,9,11,13,15,17,19,21")
```

## Single element builds

```yaml
# Add build with specific delivery
add_build_in(slide_number=10, element_type="text", element_index=18, effect="Appear", delivery="By Paragraph")

# Remove build
remove_build_in(slide_number=10, element_type="text", element_index=18)
```

## Available effects

`Appear`, `Dissolve`, `Move In`, `Fade and Move`, `Scale`, `Pop`, `Typewriter`

## Delivery options (for add_build_in only)

| Option | Behavior |
|--------|----------|
| All at Once | Entire element appears at once (default for batch tool) |
| By Paragraph | Each paragraph/bullet appears on click |
| By Highlighted Paragraph | Current highlighted, previous dimmed |

## Slide structure pattern

On most slides, each bullet is two separate text items:
```
TEXT:6  →  •           (bullet dot — auto-skipped by batch tool)
TEXT:7  →  the actual text content  (gets the build)
```
The dots remain visible as outline structure; text appears on click.

For slides where "• text" is a single item, include that index directly.

## Requirements

- **Accessibility permissions**: System Events must have accessibility access
- **Keynote frontmost**: The app must be the active window
- **~6 seconds per element**: UI scripting is slow
- **Build Order**: Auto-assigned by Keynote. Manual reorder only in Keynote UI.
- **"With Previous" timing**: NOT automatable via MCP — only available in Build Order panel

## Tips

- **NEVER add builds to shapes** — container shapes (boxes, borders, callout backgrounds) are structural and must always be visible from slide open. Only add builds to text and image content inside them.
- Skip title (TEXT:1), subtitle (TEXT:2), and slide number items
- Skip empty items at position (0,0) — these are theme placeholders
- For PDF export with build stages: File → Export to → PDF → "Print each stage of builds"
