# Anybox desktop subscription settings — design QA

## Evidence

- Reference: `C:\Projects\Anybox\artifacts\subscription-reference.png`
- Implementation (light): `C:\Projects\Anybox\artifacts\subscription-settings-light.png`
- Implementation (dark): `C:\Projects\Anybox\artifacts\subscription-settings-dark.png`
- Side-by-side comparison: `C:\Projects\Anybox\artifacts\subscription-design-comparison.png`
- Reference viewport: 982 × 753
- Implementation viewport: 1442 × 961 native Electron window
- State compared: signed in, no active subscription, plan catalog loaded, no payment order started

## Comparison history

### Pass 1 — final

- Confirmed the reference information architecture is preserved: subscription navigation, quota summary, plan catalog, payment choice, and subscribe CTA.
- Deliberately retained the existing Anybox settings shell, typography, spacing scale, icons, radii, and theme tokens instead of copying the competitor's branded plan colors.
- The current Provider catalog contains one public plan, so the implementation renders one full-width plan card. The grid remains data-driven and supports additional plans without a layout rewrite.
- Reference and implementation have different native application viewports. The side-by-side artifact normalizes both into equal comparison slots without cropping either source.
- No clipped content, overlapping controls, broken alignment, inconsistent borders, unreadable text, or P0–P2 visual defects were found.

## Functional and accessibility checks

- Navigation item and controls expose accessible names.
- Payment method uses a radio group; plan actions are buttons.
- Disconnected, loading, error, current-plan, pending-order, paid-order, Alipay redirect, and WeChat QR states are implemented.
- OAuth access token remains in the Electron main process and is not exposed to the renderer.
- Light and Night Workbench dark themes were visually checked; the original theme was restored afterward.
- Real payment creation was intentionally not triggered during QA.

## Result

Passed. The native subscription entry matches the requested flow and Anybox's established desktop design language.

## Third-party Skill catalog productization — 2026-07-16

### Evidence

- Reference: `C:\Users\19128\AppData\Local\Temp\codex-clipboard-0ddceb1f-4e30-47c2-9c01-24aa65494f80.png`
- Implementation: native `com.anybox.app.dev` Electron window, visually captured with Windows Graphics Capture while the third-party Skill dialog was open.
- Comparison: the reference and implementation captures were reviewed together in one comparison input.
- State compared: Tencent SkillHub results loaded, remote icons settled, product metadata visible, one catalog row selected, and the detail/download flow available.

### Visual and interaction review

- The catalog now preserves the reference hierarchy: 40px product icon, name, category, verification/API-key state, one-line summary, muted metadata, star/download metrics, and source.
- Anybox's settings-like modal and list/detail structure remain intact; the catalog pane is widened to 460px and shows stable truncation rather than horizontal overflow.
- Real SkillHub icons render with fixed dimensions; local skills plus missing or failed remote images use the same custom Skill brand mark without layout shift.
- Hover and selected surfaces retain Anybox tokens and do not change row geometry. The selected row remains visibly distinct after the pointer leaves.
- The API-key and verification marks are visually separate from security-scan state, avoiding a misleading trust equivalence.
- No clipped icons, overlapping controls, broken alignment, unreadable labels, or P0–P2 visual defects were found in the inspected state.

### Functional, security, and accessibility checks

- Marketplace images allow HTTPS/data sources only and use lazy loading, async decoding, and a no-referrer policy.
- Downloaded rows reject remote image URLs and use only validated locally cached PNG/JPEG/WebP data URLs, so closing the marketplace does not create a new external image request.
- Search, provider filters, row selection, detail tabs, source navigation, and local download controls remain operable.
- Product icons, verification badges, API-key badges, and metrics expose accessible names; image failures are covered by a fallback test.
- Focused renderer tests: 18 passed. Shared contract tests: 7 passed. Registry provider/managed tests: 57 passed. Desktop and shared typechecks passed.
- A full desktop Vitest run reported 136 test files passed and 1662 tests passed with 1 skipped before the wrapper timeout.

final result: passed
