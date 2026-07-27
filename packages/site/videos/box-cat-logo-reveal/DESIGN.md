---
colors:
  background: "#080908"
  background_elevated: "#111311"
  foreground: "#F4F4EF"
  secondary: "#858A84"
  shadow: "#030403"
typography:
  display:
    family: "IBM Plex Mono"
    weight: 600
  utility:
    family: "IBM Plex Mono"
    weight: 400
spacing:
  safe_x: 160
  safe_y: 96
components:
  dot_size: 6
  dot_pitch: 22
  line_weight: 2
---

## Style Prompt

Monochrome dot-matrix logo reveal on a warm near-black canvas. The box-cat
silhouette should feel precise but playful: ordered dots assemble into the box,
the cat rises with a small tactile overshoot, the eyes blink once, and the
tail completes the mark before the original raster logo locks cleanly in place.
Use restrained depth, one soft localized glow, and generous negative space.

## Colors

- `#080908` — primary canvas.
- `#111311` — localized depth and glow tint.
- `#F4F4EF` — Logo and active dots; warm white instead of pure white.
- `#858A84` — inactive grid dots.
- `#030403` — eye blink masks and deep shadow.

## Typography

No user-facing text is included in this version. If utility labels are needed
during development, use IBM Plex Mono and remove them from the final frame.

## Motion

- First visible motion begins after 0.18 seconds.
- Ordered point activation, not random noise.
- Box motion is weighty; cat motion is slightly elastic; final lockup is still.
- The final clear Logo holds for at least 0.75 seconds.

## What NOT to Do

- Do not introduce unapproved hues, neon cyan, purple gradients, or colored glow.
- Do not redraw or reinterpret the cat silhouette.
- Do not use heavy glitch, uncontrolled flicker, or unseeded randomness.
- Do not add a wordmark, tagline, URL, or product claim.
- Do not end on black; end on the complete Logo.
