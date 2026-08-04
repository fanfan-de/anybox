# Coordinate and Layout Reference

## Slide dimensions

- Size: 1920 x 1080 px
- Center: (960, 540)
- Safe area: 96px margins = x: 96..1824, y: 54..1026
- Safe content area: 1728 x 972 px

## Character width estimates

Use these to calculate x position for visual centering.

| Font size | Style | Approx px per character |
|-----------|-------|------------------------|
| 96pt | Bold | ~55 px |
| 72pt | Bold | ~42 px |
| 64pt | Bold | ~38 px |
| 56pt | Bold | ~33 px |
| 48pt | Regular | ~28 px |
| 36pt | Regular | ~21 px |
| 32pt | Regular | ~19 px |
| 28pt | Regular/Light | ~16 px |
| 26pt | Regular/Light | ~15 px |
| 24pt | Regular/Light | ~14 px |
| 20pt | Mono | ~12 px |
| 18pt | Regular | ~10 px |

## Centering formula

```
text_width = character_count * px_per_char
x = 960 - (text_width / 2)
```

Example: "Architecture" (12 chars) at 64pt bold:
```
text_width = 12 * 38 = 456
x = 960 - 228 = 732
```

## Vertical spacing patterns

### Hero slide (content centered vertically)
```
title:    y = 260-320
subtitle: y = title_y + 100
tags:     y = subtitle_y + 80
footer:   y = 950-960
```

### Content slide (title at top)
```
title:    y = 80-120
subtitle: y = title_y + 80-100
content:  y = subtitle_y + 100-140
footer:   y = 950-960
```

### Statement slide (single centered text)
```
quote:    y = 350-420
```

## Element height estimates

| Element type | Approx height |
|-------------|---------------|
| Title (48pt) | 60-70 px |
| Title (64pt) | 80-90 px |
| Title (96pt) | 120-140 px |
| Subtitle (28pt) | 40-50 px |
| Bullet item (24pt) | 45-55 px per item |
| Code line (20pt) | 35-40 px per line |
| Text box (default) | 50-60 px |

## Avoiding horizontal overflow

Maximum comfortable text width at various sizes:
- 96pt: ~12-14 characters
- 64pt: ~20-22 characters
- 48pt: ~30 characters
- 28pt: ~55 characters
- 24pt: ~65 characters
- 20pt mono: ~80 characters

If text exceeds these limits, it will wrap or overflow. Break into multiple lines or use smaller font.
