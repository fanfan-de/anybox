# Font Size Bug — Detailed Workaround

## The problem

`add_title` and `add_text_box` create a default-sized text box, THEN set the font size. If the font is large (>48pt), the text is clipped/truncated to 1-2 characters because the box is too small.

## Safe font sizes (no workaround needed)

| Tool | Max safe size |
|------|--------------|
| add_title | 48pt |
| add_subtitle | 32pt |
| add_bullet_list | 28pt |
| add_numbered_list | 28pt |
| add_code_block | 20pt |
| add_text_box | default (~24pt) |

## Workaround for large titles (>48pt)

### Step-by-step

```yaml
# 1. Add the title at the desired font size (text WILL be clipped)
add_title(slide_number=1, title="Keynote MCP", x=480, y=260, font_size=96)

# 2. Find the element index
get_slide_content(slide_number=1)
# Returns: TEXT:4:::r:::480,260:::43,123  (text truncated to "r")

# 3. Resize the box to fit the large text
resize_element(slide_number=1, element_type="text", element_index=4, width=900, height=140)

# 4. Restore the truncated text
edit_text_item(slide_number=1, item_index=4, new_text="Keynote MCP")
```

### Width/height guidelines for resize

| Font size | Suggested box width | Suggested box height |
|-----------|-------------------|---------------------|
| 96pt | 900-1200 | 130-150 |
| 72pt | 800-1000 | 100-120 |
| 64pt | 700-900 | 90-110 |
| 56pt | 600-800 | 80-100 |

Adjust width based on text length: `width = char_count * px_per_char + 50` (buffer).

### How to know if text was truncated

After `get_slide_content`, the text field shows what Keynote actually displays:
- Full text visible: `TEXT:4:::Keynote MCP:::480,260:::302,63` — OK
- Truncated: `TEXT:4:::r:::480,260:::43,123` — NEEDS FIX

If truncated, you MUST call `edit_text_item` to restore the original text.
