# Text Composer design QA

- Source visual truth: `C:/Users/19128/AppData/Local/Temp/codex-clipboard-00bb9fc7-ffd3-472d-b338-5e34fbad1a87.png`
- Final implementation screenshot: `C:/Projects/Anybox/packages/cinema-web/.audit/composer-redesign-qa/07-final-dark-full.png`
- Light-theme evidence: `C:/Projects/Anybox/packages/cinema-web/.audit/composer-redesign-qa/05-light-composer.png`
- Narrow-window evidence: `C:/Projects/Anybox/packages/cinema-web/.audit/composer-redesign-qa/09-narrow-760.png`
- Viewport: 1280 × 720 primary; 760 × 768 responsive check
- State: text node selected, multimodal GPT-5.5 selected, one available reference image, empty generation prompt, submit disabled

## Full-view comparison evidence

The reference and final implementation were inspected together in one comparison pass. The implementation now preserves the reference's defining composition: one quiet outer surface, attachment slots at the upper-left, an open borderless prompt area, compact generation type and model controls at the lower-left, and one circular primary action at the lower-right. The implementation intentionally retains Anybox tokens, localized copy, real connected-image state, and node-canvas positioning rather than cloning the competitor's product chrome.

Focused-region comparison was not required: the redesigned Composer is the only target surface and both source and implementation render it at more than 480 px wide with typography, spacing, controls, border, and attachment treatment readable in the full-view evidence.

## Required fidelity surfaces

- Fonts and typography: existing Anybox system font retained; prompt is 13 px/1.5; bottom controls are 13 px with differentiated 650/600 weights. Long model names remain ellipsized.
- Spacing and layout rhythm: 520 × 218 px in the verified multimodal state; 12 px outer padding; image slots and prompt share one content area; footer uses a compact horizontal toolbar. At 760 px the Composer reflows to the viewport with all persistent actions visible.
- Colors and visual tokens: surface, border, shadow, toolbar, focus, disabled, and primary-action colors use runtime light/dark tokens. Reference-image removal no longer relies on a hard-coded dark surface.
- Image quality and asset fidelity: actual project thumbnails are rendered with cover cropping; empty attachment uses the existing Lucide image icon and dashed slot pattern. No placeholder art or generated raster asset was required.
- Copy and content: existing localized `文本生成`, selected model name, prompt placeholder, accessible labels, and image actions are preserved.

## Interaction and accessibility checks

- Composer opens from the selected text node without losing selection.
- Model list opens above clipping containers and remains clickable.
- Selected model receives focus; Arrow Up/Down, Home/End, and Escape work; Escape restores focus to the trigger.
- `aria-controls`, `aria-expanded`, listbox, option, and selected semantics are present.
- Light and dark themes were checked; the original dark preference was restored.
- Browser console warnings/errors checked: none.

## Comparison history

### Iteration 1

- [P2] The 1280 × 720 multimodal state clipped the Composer footer inside the overlay scroll container.
- Earlier fix: the node viewport guard was generalized to text nodes and included the overlay content's true bounds when calculating canvas pan.
- Superseded behavior: the viewport guard has since been removed. Composer now remains horizontally centered below its node and may move outside the visible canvas; `04-viewport-guard-fixed.png` is retained only as historical evidence.

### Iteration 2

- [P2] Bottom-toolbar typography was visually smaller and heavier than the selected reference.
- Fix: increased toolbar text to 13 px and separated mode/model weights to 650/600.
- Post-fix evidence: `07-final-dark-full.png`; hierarchy matches the reference while retaining Anybox styling.

## Residual P3 polish

- The reference includes an expand icon, but Anybox has no corresponding Composer action. It was intentionally omitted instead of adding a non-functional control.
- The enabled submit appearance was validated through semantic primary-button tokens; the captured real-project state is disabled because the prompt is empty.

final result: passed
