# Design QA — Homepage streaming demo split layout

## Evidence

- Source visual truth: `C:\Users\19128\AppData\Local\Temp\codex-clipboard-b6ebf7ed-9ab0-42a4-b621-b376e4d62403.png`
- Requested delta: replace the stacked heading/video composition with a desktop left/right split where video holds the majority and supporting copy sits beside it.
- Desktop implementation: `C:\Users\19128\AppData\Local\Temp\anybox-site-layout-qa-20260721\second-screen-desktop-2528-v4.png`
- Mobile implementation: `C:\Users\19128\AppData\Local\Temp\anybox-site-layout-qa-20260721\second-screen-mobile.png`
- Full-view comparison: `C:\Users\19128\AppData\Local\Temp\anybox-site-layout-qa-20260721\reference-vs-left-right-v2.png`
- Focused copy comparison: `C:\Users\19128\AppData\Local\Temp\anybox-site-layout-qa-20260721\focused-copy-comparison.png`
- Desktop viewport: 2528 × 1176, Chinese, dark theme, second homepage section, video paused at 12 seconds for deterministic visual comparison.
- Mobile viewport: 390 × 844, Chinese, dark theme, stacked responsive state.

## Findings

- No remaining P0, P1, or P2 issues.
- Typography: the existing Segoe UI Variable / Microsoft YaHei UI stack, strong display weight, compact line height, and lime kicker match the source visual language. The right-column title wraps as a deliberate two-line block without clipping.
- Spacing and layout rhythm: desktop uses an approximately 70/30 media-to-copy split with a clear central gutter. The media remains the dominant visual. Mobile returns to a single-column flow with no horizontal overflow or clipped controls.
- Colors and visual tokens: the implementation retains the source black stage, subdued blue/pink ambient glow, white display type, muted supporting text, and lime status accent through existing project tokens.
- Image quality and asset fidelity: the supplied 2560 × 1440 H.264 product recording and its real poster asset are reused without stretching, replacement art, or destructive cropping. The 16:9 frame remains intact.
- Copy and content: the original headline and explanation are preserved. Three short supporting points add useful information to the newly available copy column without changing the product claim.
- Interaction and accessibility: play/pause was tested through the visible control (`playing → paused → playing`). The video still pauses outside the viewport and honors reduced-motion preferences. No browser console errors were observed.

## Comparison History

1. Initial split-layout capture kept the section capped at 1600px. At the 2528px source viewport, this left too much unused horizontal space and made the product recording noticeably smaller than the visual target (P2).
2. The section cap was increased to 1960px while retaining the 1.9fr / 0.7fr grid. The revised capture gives the video a 1362px rendered width, keeps the copy at a readable 440px maximum, and restores the intended dominant-media balance.
3. Post-fix evidence is recorded in `second-screen-desktop-2528-v4.png` and `reference-vs-left-right-v2.png`; the P2 issue is resolved.

## Focused Review

The focused comparison checks headline weight and wrapping, kicker color, body contrast, supporting-list density, divider opacity, and copy alignment. A separate media crop was unnecessary because the same supplied video asset and unchanged 16:9 frame are used in both layouts.

## Follow-up Polish

- P3: if the copy changes substantially later, reassess the 980px stacking breakpoint so translated text does not make the second screen unnecessarily tall.

## Final Result

final result: passed
