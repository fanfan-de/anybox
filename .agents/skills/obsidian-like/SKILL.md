---
name: obsidian-like
description: Design desktop application settings, preferences, plugin management, and configuration screens in a quiet Obsidian-like visual style. Use when Codex needs to build, restyle, critique, or generate prompts/CSS/components for settings UI with a left navigation sidebar, neutral surfaces, subtle dividers, rounded setting panels, compact controls, and purple accent actions.
---

# Obsidian Like

## Core Direction

Create a mature desktop productivity settings interface: quiet, utilitarian, low contrast, spacious, and component-driven. Favor the feel of a native app preferences window over a marketing page or decorative web dashboard.

Use this style primarily for:

- Settings and preferences pages
- Account, update, language, editor, appearance, hotkey, plugin, sync, and advanced configuration screens
- Desktop app dialogs with persistent navigation and dense repeated controls
- Frontend prompts that need an Obsidian-like settings aesthetic

## Layout

Use a two-pane desktop layout.

- Left sidebar width: `280px` to `300px`
- Sidebar background: near-white gray, such as `#fbfbfb` or `#fafafa`
- Main background: `#ffffff` or very light neutral
- Divider between sidebar and content: `1px solid #dedede` or softer
- Main content max width: `880px` to `920px`
- Main content horizontal padding: `56px` to `72px` on desktop
- Top/right close action: small gray `X` icon button with minimal hover feedback

Keep the main content aligned with generous whitespace. Do not fill the whole width with dense cards unless the product already uses that pattern.

## Sidebar

Build the sidebar as grouped navigation.

- Group labels: small, muted, gray text; examples: `Options`, `Core plugins`, `Third-party plugins`
- Nav rows: icon plus label, about `32px` high
- Icons: thin line icons, dark gray, approximately `18px`
- Text: `14px` to `15px`, dark gray
- Selected item: light gray rounded rectangle, `5px` to `6px` radius, no strong accent color
- Group spacing: visibly separate groups with vertical gaps around `28px` to `36px`

Use the accent color sparingly; the selected sidebar state should usually be neutral, not purple.

## Content Sections

Structure content as section headings followed by grouped setting panels.

- Section title: `18px` to `20px`, weight `600`, near-black
- Section spacing: `28px` to `36px` between major groups
- Panel background: `#fafafa`, `#f8f8f8`, or equivalent neutral surface
- Panel radius: about `12px`
- Panel padding: `24px`
- Panel shadow: none, or a barely perceptible border/shadow only if needed for separation
- Internal dividers: `1px solid #e2e2e2`

Do not nest cards inside cards. A settings panel may contain rows, but rows should not become separate decorative cards.

## Setting Rows

Each setting row should feel scannable and compact.

- Row height: usually `72px` to `96px`, depending on description length
- Left side: setting title and helper text
- Right side: control aligned vertically center
- Title: `15px` to `16px`, medium or regular weight, near-black
- Description: `13px` to `14px`, muted gray, compact line height
- Links inside descriptions: purple accent, no default underline

Keep controls close to the right edge of the panel. Leave enough text width so Chinese and English labels do not wrap awkwardly.

## Row-First Settings Standard

When restyling an existing desktop settings page, prefer the row-first pattern used by the Appearance settings:

- Use one light neutral rounded panel per related setting group, usually `#fafafa` with `8px` to `10px` radius.
- Inside the panel, use rows separated by `1px solid #dedede`; do not create separate cards for individual settings.
- Each row uses a two-column grid: left `minmax(0, 1fr)`, right `156px` to `220px`, with `18px` to `32px` column gap.
- Row padding should be around `16px 0` inside a `24px` padded panel. Minimum row height should be about `76px`.
- Left copy uses a title and optional helper description. Title: `15px`, weight `500`, color near `#1f1f1f`. Description: `13px`, color around `#6d6a66`, line-height around `1.45`.
- Right controls are compact and right-aligned. Selects are about `34px` tall, light gray (`#eeeeee`) with a `#d9d9d9` border and `6px` radius. Buttons are also about `34px` tall.
- Toggles should appear as the right-side control of a row, not as a separate decorative card. Hide nonessential leading icons in setting rows when the Appearance page standard is being used.
- On narrow screens, collapse rows to a single column and stretch the control to the row width.

This pattern should be used for preference-style pages such as General, Appearance, Developer, update settings, language settings, and other app preferences. Do not force dense management surfaces such as provider catalogs, model lists, archived session lists, or marketplace directories into this pattern when their data needs richer list or table treatment.

## Controls

Use familiar desktop controls with restrained styling.

- Primary buttons: purple background near `#8b5cf6` or `#8f63e9`, white text, `6px` radius
- Secondary buttons: white background, light gray border, dark text, `6px` radius
- Buttons: compact height around `34px` to `38px`; no oversized CTA styling
- Select inputs: white background, light gray border, subtle radius, native or simple arrow
- Toggles: capsule track; purple when on, gray when off, white thumb
- Icon-only controls: use line icons and tooltips when the action is not obvious

Use purple only for affirmative, active, or link states. Avoid using it as a broad background or decorative gradient.

## Visual Tokens

Start from these tokens and adapt to the host codebase:

```css
:root {
  --obs-bg: #ffffff;
  --obs-sidebar-bg: #fafafa;
  --obs-surface: #f8f8f8;
  --obs-surface-subtle: #fbfbfb;
  --obs-border: #dedede;
  --obs-border-subtle: #e7e7e7;
  --obs-text: #1f1f1f;
  --obs-text-muted: #666666;
  --obs-text-faint: #8a8a8a;
  --obs-accent: #8b5cf6;
  --obs-accent-hover: #7c4fe8;
  --obs-radius-panel: 12px;
  --obs-radius-control: 6px;
}
```

## Prompt Pattern

When asked to write a design prompt, include:

```text
Create a quiet Obsidian-like desktop settings interface: two-pane layout with a narrow left navigation sidebar, subtle gray selected nav item, centered main content, rounded light-gray settings panels, compact setting rows with dividers, muted helper text, simple secondary buttons, purple accent primary buttons and toggles, low contrast neutral palette, no decorative gradients, no marketing hero, no nested cards.
```

## Avoid

- Marketing landing-page composition
- Large hero sections or oversized headings
- Decorative gradients, blurred blobs, or ornamental illustrations
- Heavy shadows or bright borders
- One-note purple backgrounds
- Card-in-card layouts
- Pill-shaped text buttons everywhere
- Excessive whitespace that makes the settings page feel sparse rather than calm
- In-app explanatory text about how the UI works unless the product genuinely needs it
