# Shape and Styling Reference

## Shape fill limitations

CRITICAL: Shape fill properties are NOT writable via AppleScript. These all fail:
- `set background fill type to color fill` → error -10006
- `set background fill type to no fill` → error -10006
- `set background color to {r,g,b}` → error -10006

## The opacity workaround

Shape `opacity` IS writable. Use low opacity (5-10%) on the default white fill to create subtle semi-transparent containers:

```yaml
# Create a container shape with low opacity
add_shape(slide=N, x=59, y=100, width=500, height=345, opacity=8)

# Or set opacity on existing shape
set_element_opacity(slide=N, element_type="shape", element_index=1, opacity=8)
```

## Text color control

`add_text_box`, `add_title`, `add_subtitle`, `add_code_block` accept an optional `color` parameter as "R,G,B" string (values 0-65535):

```yaml
# White text (standard for dark themes)
add_text_box(slide=N, text="...", color="65535,65535,65535")

# Light gray (subtitles, secondary text)
add_text_box(slide=N, text="...", color="45000,45000,45000")

# Green (code comments)
add_code_block(slide=N, code="# comment", color="30000,55000,30000")
```

## Color values for dark themes

| Purpose | RGB String |
|---------|-----------|
| White (primary text) | `65535,65535,65535` |
| Light gray (subtitles) | `45000,45000,45000` |
| Medium gray (callout) | `55000,55000,55000` |
| Code text | `60000,60000,60000` |
| Code comments (green) | `30000,55000,30000` |
| Code headers (blue) | `40000,50000,60000` |

## When NOT to use shapes

On dark backgrounds, well-positioned text with good spacing often reads better WITHOUT container shapes. Only add shapes when:
- You need visual column separation
- The layout has distinct regions (code vs bullets vs callout)
- Multiple content blocks might blend together
