# Slide Templates

All coordinates assume 1920x1080 slide. CENTER means calculate x for centering (see coordinate-reference.md).

## Hero slide

```yaml
add_title(slide=1, title="Product Name", x=CENTER, y=260, font_size=96)
# → resize + edit_text_item to fix clipping
add_subtitle(slide=1, subtitle="One-line tagline", x=CENTER, y=440, font_size=32)
add_text_box(slide=1, text="tag1 // tag2 // tag3", x=CENTER, y=520)
add_text_box(slide=1, text="github.com/user/repo", x=CENTER, y=960)
```

## Statement / hook slide

```yaml
add_quote(slide=2, quote="Provocative question or statement?", x=280, y=380, font_size=48)
```

## Title + bullets slide

```yaml
add_title(slide=N, title="Section Name", x=CENTER, y=100, font_size=64)
add_subtitle(slide=N, subtitle="Supporting context", x=CENTER, y=190, font_size=26)
add_bullet_list(slide=N, items=[...], x=350, y=340, font_size=26)
```

## Feature grid slide (label + description pairs)

```yaml
add_title(slide=N, title="30+ Tools", x=CENTER, y=100, font_size=72)
add_subtitle(slide=N, subtitle="organized in 5 modules", x=CENTER, y=195, font_size=28)
# Pairs at x=200, stepping y by 130:
add_text_box(slide=N, text="Presentation",    x=200, y=340)
add_text_box(slide=N, text="create / open / save / close", x=200, y=390)
add_text_box(slide=N, text="Slides",           x=200, y=470)
add_text_box(slide=N, text="add / delete / duplicate",     x=200, y=520)
```

## Code demo slide

```yaml
add_title(slide=N, title="How It Works", x=CENTER, y=80, font_size=56)
add_subtitle(slide=N, subtitle="Short explainer", x=CENTER, y=165, font_size=28)
add_code_block(slide=N, code="...", x=350, y=300, font_size=20, font_name="Menlo")
# Keep code to 5-7 lines MAX
```

## Closing slide

```yaml
add_title(slide=N, title="Big closing statement.", x=CENTER, y=340, font_size=56)
add_subtitle(slide=N, subtitle="Supporting line.", x=CENTER, y=430, font_size=30)
add_text_box(slide=N, text="link or repo", x=CENTER, y=580)
add_text_box(slide=N, text="License // Credits", x=CENTER, y=960)
```

## Two-column layout

Used for deep-dive or comparison slides. Coordinates for 1920x1080:

```yaml
# Title + subtitle
add_title(slide=N, title="...", x=100, y=40, font_size=58)
add_subtitle(slide=N, subtitle="...", x=100, y=110, font_size=28)

# Left column container (wider, for code)
add_shape(slide=N, x=118, y=200, width=1000, height=690, opacity=8)

# Right column container (narrower, for bullets)
add_shape(slide=N, x=1172, y=200, width=660, height=690, opacity=8)

# Bottom callout bar
add_shape(slide=N, x=118, y=924, width=1714, height=80, opacity=8)

# Slide number
add_text_box(slide=N, text="05", x=1822, y=1020, font_size=24)
```
