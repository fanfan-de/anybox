# Anybox brand kit

## Direction

**Folded Companion** refines the existing “cat in an open box” asset into a small native-SVG system. The cat keeps the approachable mascot cue; the three box planes add structure and communicate an open, extensible workspace.

## Primary assets

- `anybox-mark-color.svg` — primary transparent mark for light surfaces.
- `anybox-mark-dark.svg` — primary transparent mark for dark surfaces.
- `anybox-app-icon.svg` — rounded-square application icon.
- `anybox-full-logo.svg` / `anybox-full-logo-dark.svg` — mark, wordmark, and product descriptor.
- `anybox-wordmark.svg` / `anybox-wordmark-dark.svg` — wordmark only.
- `anybox-mark-mono-dark.svg` / `anybox-mark-mono-light.svg` — one-color fallbacks.
- `favicon.svg`, `favicon-16.png`, `favicon-32.png`, and `favicon.ico` — browser assets.
- `social-preview.svg`, `social-preview.png`, and `social-preview.webp` — 1200 × 630 social card.

## Palette

| Role | Hex | Use |
| --- | --- | --- |
| Companion Ink | `#15201B` | Cat, wordmark, strong foreground |
| Open Teal | `#2F6F68` | Box and primary brand accent |
| Night | `#151817` | App-icon and dark presentation surface |
| Night Teal | `#76B8AD` | Box on dark surfaces |
| Paper | `#F4F7F4` | Light mark and inverse text |
| Warm Paper | `#F2EFE5` | Editorial and social backgrounds |

The mark is intentionally flat: do not add shadows, outlines, gradients, or extra colors to the primary SVG.

## Typography

The live-text wordmark uses this system stack:

```css
font-family: "Segoe UI Variable Display", "Segoe UI", Arial, sans-serif;
font-weight: 700;
```

This keeps normal web and product usage lightweight. Convert text to paths only for a specific print/offline handoff after checking kerning.

## Sizing and spacing

- Preferred clear space: at least 12% of the mark width on every side.
- Minimum mark size: 16 px digital; use `favicon.svg` or the dedicated favicon PNG below 24 px.
- Minimum full-logo height: 32 px. Below that, use the icon-only mark.
- Keep the mark's aspect ratio; never stretch or crop it.
- On app launchers, use `anybox-app-icon.svg` rather than placing the transparent mark directly on an arbitrary tile.

## Background rules

- Light backgrounds: `anybox-mark-color.svg` or `anybox-full-logo.svg`.
- Dark backgrounds: `anybox-mark-dark.svg` or `anybox-full-logo-dark.svg`.
- Single-ink production: use the matching monochrome asset.
- Avoid photographs or high-frequency textures immediately behind the mark.

## Integrity

All mark geometry in this kit is original native SVG and has no external network dependencies. The wordmark references system fonts rather than bundling font files. Font licensing, code licensing, and trademark clearance remain separate checks; this design pass does not constitute trademark clearance.
