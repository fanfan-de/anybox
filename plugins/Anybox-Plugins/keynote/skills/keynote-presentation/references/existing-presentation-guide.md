# Working with Existing Presentations

## Duplicating slides as templates

When adding slides to an existing deck, duplicate rather than create blank. This preserves theme styling, backgrounds, and visual consistency.

```yaml
# Duplicate slide 9 to create a new slide right after it
duplicate_slide(slide_number=9)
# → Creates slide 10 as a copy of slide 9

# Duplicate to a specific position
duplicate_slide(slide_number=9, new_position=11)
# → Inserts copy at position 11
```

## Clearing a duplicated slide

After duplicating, remove content while preserving background:

```yaml
clear_slide(slide_number=10)
# Removes: all text items and shapes
# Preserves: background image, theme placeholders at (0,0)
```

If `clear_slide` has issues, delete elements manually from HIGHEST index to LOWEST:
```yaml
get_slide_content(slide_number=10)
# Delete shapes first, then text items
# Skip items at position (0,0) — theme placeholders
delete_element(slide_number=10, element_type="text", element_index=15)
delete_element(slide_number=10, element_type="text", element_index=14)
# ... etc, always descending
```

## Opening existing files

```yaml
open_presentation(file_path="/path/to/presentation.key")
```

## Avoiding horizontal overflow

NEVER put long text on one line. Use vertical flow instead:

```yaml
# BAD — overflows right edge:
add_text_box(text="Claude Code --> MCP Server --> Tool Classes --> AppleScript --> Keynote")

# GOOD — use vertical flow:
add_text_box(text="Claude Code",        x=810, y=230)
add_text_box(text="v",                  x=930, y=290)
add_text_box(text="MCP Server (stdio)", x=760, y=340)
add_text_box(text="v",                  x=930, y=400)
```

## Index shifting after insert

After inserting N slides at position P, all slides after P shift by N. Display slide numbers are hardcoded per-slide, so no content changes needed on existing slides.
